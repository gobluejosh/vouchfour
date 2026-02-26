import { query } from './db.js'

/**
 * Get talent recommendations for a user, scored by degree and recommendation count.
 *
 * Network traversal is function-AGNOSTIC (follows all vouch chains regardless of
 * function). The function filter is applied only at the output level — a person
 * appears in results only if they have a vouch in the target function pointing to them.
 *
 * Cross-function results: when filtering by function, a result is "cross-function"
 * if the user has NOT personally vouched for that person in the target function.
 * These results receive a configurable discount multiplier on their score.
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
      -- All user's direct vouchees (function-agnostic, used for network traversal)
      all_seeds AS (
        SELECT DISTINCT vouchee_id AS person_id
        FROM vouches
        WHERE voucher_id = $1
      ),

      -- Function-specific degree 1 (used only for cross-function detection and rec count)
      fn_degree1 AS (
        SELECT DISTINCT vouchee_id AS person_id
        FROM vouches
        WHERE voucher_id = $1
          AND ($2::int IS NULL OR job_function_id = $2)
      ),

      -- Sponsors: people who vouched FOR the user (function-agnostic for broader reach)
      sponsors AS (
        SELECT DISTINCT voucher_id
        FROM vouches
        WHERE vouchee_id = $1
      ),

      -- Siblings: other people those sponsors vouched for (function-agnostic)
      siblings AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM sponsors s
        JOIN vouches v ON v.voucher_id = s.voucher_id
        WHERE v.vouchee_id != $1
      ),

      -- Degree 2 sources: all direct vouchees + siblings (function-agnostic)
      degree2_sources AS (
        SELECT person_id FROM all_seeds
        UNION
        SELECT person_id FROM siblings
      ),

      -- Degree 2: function-agnostic traversal from degree2 sources
      degree2 AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2_sources d2s
        JOIN vouches v ON v.voucher_id = d2s.person_id
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM all_seeds)
      ),

      -- Degree 3: function-agnostic traversal from degree2 people
      degree3 AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2 d2
        JOIN vouches v ON v.voucher_id = d2.person_id
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM all_seeds)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
      ),

      -- Assign degrees (all_seeds = degree 1, then degree 2, degree 3)
      all_talent AS (
        SELECT person_id, 1 AS degree FROM all_seeds
        UNION ALL
        SELECT person_id, 2 AS degree FROM degree2
        UNION ALL
        SELECT person_id, 3 AS degree FROM degree3
      ),

      -- Best (closest) degree per person
      best_degree AS (
        SELECT person_id, MIN(degree) AS degree
        FROM all_talent
        GROUP BY person_id
      ),

      -- Score and filter by function at output level
      scored AS (
        SELECT
          bd.person_id,
          bd.degree,
          CASE
            WHEN $2::int IS NULL THEN FALSE
            WHEN EXISTS (SELECT 1 FROM vouches WHERE voucher_id = $1 AND job_function_id = $2) THEN FALSE
            ELSE TRUE
          END AS is_cross_function,
          CASE
            WHEN bd.degree = 1 AND ($2::int IS NULL OR bd.person_id IN (SELECT person_id FROM fn_degree1)) THEN 1
            ELSE (
              SELECT COUNT(DISTINCT v.voucher_id)
              FROM vouches v
              WHERE v.vouchee_id = bd.person_id
                AND ($2::int IS NULL OR v.job_function_id = $2)
            )
          END AS recommendation_count
        FROM best_degree bd
        WHERE $2::int IS NULL
          OR EXISTS (
            SELECT 1 FROM vouches
            WHERE vouchee_id = bd.person_id AND job_function_id = $2
          )
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
    WHERE s.recommendation_count > 0
    ORDER BY vouch_score DESC, s.degree ASC, p.display_name ASC
  `, [userId, jobFunctionId, crossFunctionDiscount])

  return result.rows.filter(r => r.degree <= maxDegree)
}
