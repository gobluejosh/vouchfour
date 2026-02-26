import { query } from './db.js'

/**
 * Get talent recommendations for a user, scored by degree and recommendation count.
 *
 * New model — pure vouch chains with sibling visibility:
 *
 *   Degree 1: User's own vouches (known to user, shown separately)
 *   Degree 2: Vouches by degree-1 people + vouches by siblings
 *             (siblings = other people vouched for by the user's sponsors)
 *   Degree 3: Vouches by degree-2 people
 *
 * Score: degree_coefficient[degree] * recommendation_count
 *   - recommendation_count = distinct vouch paths reaching talent at the best (closest) degree
 *   - If same talent reachable at multiple degrees, uses the closest degree
 *
 * @param {number} userId - people.id of the user
 * @param {number|null} jobFunctionId - job_functions.id to filter by, or null for all functions
 * @param {number} maxDegree - maximum degree to include in results (default 3)
 * @returns {Array<{id, display_name, linkedin_url, email, degree, recommendation_count, vouch_score}>}
 */
export async function getTalentRecommendations(userId, jobFunctionId = null, maxDegree = 3) {
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

      -- Degree 2 sources: degree1 people + siblings + all seeds (cross-function bridge)
      degree2_sources AS (
        SELECT person_id FROM degree1
        UNION
        SELECT person_id FROM siblings
        UNION
        SELECT person_id FROM all_seeds
      ),

      -- Degree 2: vouches by degree2 sources, excluding user and degree1
      degree2 AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2_sources d2s
        JOIN vouches v ON v.voucher_id = d2s.person_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
      ),

      -- Degree 3: vouches by degree2 people, excluding user, degree1, degree2
      degree3 AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2 d2
        JOIN vouches v ON v.voucher_id = d2.person_id
          AND ($2::int IS NULL OR v.job_function_id = $2)
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
      ),

      -- Combine all degrees with degree labels and recommendation counts
      all_talent AS (
        SELECT person_id, 1 AS degree FROM degree1
        UNION ALL
        SELECT person_id, 2 AS degree FROM degree2
        UNION ALL
        SELECT person_id, 3 AS degree FROM degree3
      ),

      -- Best degree per person
      best_degree AS (
        SELECT person_id, MIN(degree) AS degree
        FROM all_talent
        GROUP BY person_id
      ),

      -- Count recommendations at each person's best degree
      -- For degree 2+, count how many distinct vouchers point to this person
      scored AS (
        SELECT
          bd.person_id,
          bd.degree,
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
        s.recommendation_count,
        ROUND(dc.coefficient * s.recommendation_count, 3) AS vouch_score
    FROM scored s
    JOIN people p ON p.id = s.person_id
    JOIN degree_coefficients dc ON dc.degree = s.degree
    ORDER BY vouch_score DESC, s.degree ASC, p.display_name ASC
  `, [userId, jobFunctionId])

  return result.rows.filter(r => r.degree <= maxDegree)
}
