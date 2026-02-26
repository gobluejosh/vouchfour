import { query } from './db.js'

/**
 * Get talent recommendations for a user, scored by degree and recommendation count.
 *
 * Pure vouch chains with sibling visibility and cross-function bridging:
 *
 *   Degree 1: User's own vouches (known to user, shown separately)
 *   Degree 2: Vouches by degree-1 people + vouches by siblings
 *             (siblings = other people vouched for by the user's sponsors)
 *             + cross-function vouches by all_seeds (user's vouchees in any function)
 *   Degree 3: Vouches by degree-2 people
 *
 * Cross-function results (reached only through all_seeds, not through in-function
 * degree1/siblings) are tagged with is_cross_function=true and scored with a
 * configurable discount multiplier.
 *
 * Score: degree_coefficient[degree] * recommendation_count * (cross_function_discount if applicable)
 *
 * @param {number} userId - people.id of the user
 * @param {number|null} jobFunctionId - job_functions.id to filter by, or null for all functions
 * @param {Object} options
 * @param {number} options.maxDegree - maximum degree to include (default 3)
 * @param {number} options.crossFunctionDiscount - multiplier for cross-function results (default 0.5)
 * @returns {Array<{id, display_name, linkedin_url, email, degree, is_cross_function, recommendation_count, vouch_score}>}
 */
export async function getTalentRecommendations(userId, jobFunctionId = null, { maxDegree = 3, crossFunctionDiscount = 0.5 } = {}) {
  const result = await query(`
    WITH
      -- Degree 1: User's own vouches in the target function
      degree1 AS (
        SELECT DISTINCT vouchee_id AS person_id
        FROM vouches
        WHERE voucher_id = $1
          AND ($2::int IS NULL OR job_function_id = $2)
      ),

      -- All seeds: User's vouchees across ALL functions (enables cross-function bridging)
      all_seeds AS (
        SELECT DISTINCT vouchee_id AS person_id
        FROM vouches
        WHERE voucher_id = $1
      ),

      -- Sponsors: people who vouched FOR the user in this function
      sponsors AS (
        SELECT DISTINCT voucher_id
        FROM vouches
        WHERE vouchee_id = $1
          AND ($2::int IS NULL OR job_function_id = $2)
      ),

      -- Siblings: other people those sponsors vouched for (excluding user)
      siblings AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM sponsors s
        JOIN vouches v ON v.voucher_id = s.voucher_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
      ),

      -- In-function degree2 sources (function-filtered: degree1 + siblings)
      degree2_sources_if AS (
        SELECT person_id FROM degree1
        UNION
        SELECT person_id FROM siblings
      ),

      -- Cross-function-only sources (all_seeds NOT already in in-function sources)
      degree2_sources_cf AS (
        SELECT person_id FROM all_seeds
        WHERE person_id NOT IN (SELECT person_id FROM degree2_sources_if)
      ),

      -- In-function degree 2
      degree2_if AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2_sources_if d2s
        JOIN vouches v ON v.voucher_id = d2s.person_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
      ),

      -- Cross-function degree 2 (not already found in-function)
      degree2_cf AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2_sources_cf d2s
        JOIN vouches v ON v.voucher_id = d2s.person_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree2_if)
      ),

      -- Combined degree 2 (for degree3 traversal)
      degree2 AS (
        SELECT person_id FROM degree2_if
        UNION
        SELECT person_id FROM degree2_cf
      ),

      -- In-function degree 3: vouches by in-function degree2 people
      degree3_if AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2_if d2
        JOIN vouches v ON v.voucher_id = d2.person_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
      ),

      -- Cross-function degree 3: vouches by cross-function degree2 people
      degree3_cf AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2_cf d2
        JOIN vouches v ON v.voucher_id = d2.person_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree3_if)
      ),

      -- Combine all degrees with cross-function flag
      all_talent AS (
        SELECT person_id, 1 AS degree, FALSE AS is_cross_function FROM degree1
        UNION ALL
        SELECT person_id, 2 AS degree, FALSE AS is_cross_function FROM degree2_if
        UNION ALL
        SELECT person_id, 2 AS degree, TRUE AS is_cross_function FROM degree2_cf
        UNION ALL
        SELECT person_id, 3 AS degree, FALSE AS is_cross_function FROM degree3_if
        UNION ALL
        SELECT person_id, 3 AS degree, TRUE AS is_cross_function FROM degree3_cf
      ),

      -- Best degree per person (prefer closest degree, then in-function over cross-function)
      best_degree AS (
        SELECT DISTINCT ON (person_id) person_id, degree, is_cross_function
        FROM all_talent
        ORDER BY person_id, degree ASC, is_cross_function ASC
      ),

      -- Count recommendations at each person's best degree
      scored AS (
        SELECT
          bd.person_id,
          bd.degree,
          bd.is_cross_function,
          CASE
            WHEN bd.degree = 1 THEN 1
            ELSE (
              SELECT COUNT(DISTINCT v.voucher_id)
              FROM vouches v
              WHERE v.vouchee_id = bd.person_id
                AND ($2::int IS NULL OR v.job_function_id = $2)
            )
          END AS recommendation_count
        FROM best_degree bd
      )

    SELECT
        p.id,
        p.display_name,
        p.linkedin_url,
        p.email,
        s.degree,
        s.is_cross_function,
        s.recommendation_count,
        ROUND(dc.coefficient * s.recommendation_count
          * CASE WHEN s.is_cross_function THEN $3 ELSE 1.0 END, 3) AS vouch_score
    FROM scored s
    JOIN people p ON p.id = s.person_id
    JOIN degree_coefficients dc ON dc.degree = s.degree
    ORDER BY vouch_score DESC, s.degree ASC, p.display_name ASC
  `, [userId, jobFunctionId, crossFunctionDiscount])

  return result.rows.filter(r => r.degree <= maxDegree)
}
