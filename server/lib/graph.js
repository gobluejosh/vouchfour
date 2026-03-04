import { query } from './db.js'

/**
 * Get talent recommendations for a user, scored by degree and recommendation count.
 *
 * Network traversal is function-AGNOSTIC (follows all vouch chains regardless of
 * function). The function filter is applied only at the output level — a person
 * appears in results only if they have a vouch in the target function pointing to them.
 *
 * Cross-function detection uses a parallel function-SPECIFIC traversal. A result is
 * "cross-function" if it can only be reached through cross-function bridges — i.e.,
 * it does NOT appear in the pure function-specific chain. In the "All" view, the
 * function-specific traversal restricts to the user's own vouch functions.
 *
 * Siblings (people vouched for by the user's sponsors) receive a configurable
 * sibling coefficient discount since the trust signal is indirect.
 *
 * Score: degree_coefficient * recommendation_count * sibling_coefficient * cross_function_discount
 *
 * @param {number} userId - people.id of the user
 * @param {number|null} jobFunctionId - job_functions.id to filter by, or null for all functions
 * @param {Object} options
 * @param {number} options.maxDegree - maximum degree to include (default 3)
 * @param {number} options.crossFunctionDiscount - multiplier for cross-function results (default 0.5)
 * @param {number} options.siblingCoefficient - multiplier for sibling-path results (default 0.8)
 * @returns {Array<{id, display_name, linkedin_url, email, degree, is_sibling, is_cross_function, recommendation_count, vouch_score}>}
 */
export async function getTalentRecommendations(userId, jobFunctionId = null, { maxDegree = 3, crossFunctionDiscount = 0.5, siblingCoefficient = 0.8 } = {}) {
  const result = await query(`
    WITH
      -- ══════════════════════════════════════════════════════════════════
      -- FUNCTION-AGNOSTIC NETWORK TRAVERSAL (for discovery)
      -- ══════════════════════════════════════════════════════════════════

      -- Degree 1: user's direct vouchees (any function)
      all_seeds AS (
        SELECT DISTINCT vouchee_id AS person_id
        FROM vouches
        WHERE voucher_id = $1
      ),

      -- Sponsors: people who vouched FOR the user (any function)
      sponsors AS (
        SELECT DISTINCT voucher_id
        FROM vouches
        WHERE vouchee_id = $1
      ),

      -- Siblings: other people those sponsors vouched for (any function)
      -- Excludes user and anyone already in degree 1
      siblings AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM sponsors s
        JOIN vouches v ON v.voucher_id = s.voucher_id
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM all_seeds)
      ),

      -- Degree 2 from direct vouchees: people vouched for by degree-1 people
      degree2_direct AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM all_seeds a
        JOIN vouches v ON v.voucher_id = a.person_id
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM all_seeds)
      ),

      -- Combined degree 2: direct vouchee chains + siblings
      degree2 AS (
        SELECT person_id FROM degree2_direct
        UNION
        SELECT person_id FROM siblings
      ),

      -- Degree 3: vouchees of degree-2 people
      degree3 AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM degree2 d2
        JOIN vouches v ON v.voucher_id = d2.person_id
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM all_seeds)
          AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
      ),

      -- Best (closest) degree per person, preferring non-sibling paths
      all_talent AS (
        SELECT person_id, 1 AS degree, FALSE AS is_sibling FROM all_seeds
        UNION ALL
        SELECT person_id, 2 AS degree, FALSE AS is_sibling FROM degree2_direct
        UNION ALL
        SELECT person_id, 2 AS degree, TRUE AS is_sibling FROM siblings
          WHERE person_id NOT IN (SELECT person_id FROM degree2_direct)
        UNION ALL
        SELECT person_id, 3 AS degree, FALSE AS is_sibling FROM degree3
      ),
      best_degree AS (
        SELECT DISTINCT ON (person_id) person_id, degree, is_sibling
        FROM all_talent
        ORDER BY person_id, degree ASC, is_sibling ASC
      ),

      -- ══════════════════════════════════════════════════════════════════
      -- FUNCTION-SPECIFIC TRAVERSAL (for cross-function detection)
      -- Follows only vouches in the target function (or the user's own
      -- vouch functions when in All view). A result that appears in the
      -- agnostic network but NOT here is cross-function.
      -- ══════════════════════════════════════════════════════════════════

      -- User's own vouch functions (used for All-view cross-function detection)
      user_functions AS (
        SELECT DISTINCT job_function_id AS fn_id
        FROM vouches
        WHERE voucher_id = $1
      ),

      fn_degree1 AS (
        SELECT DISTINCT vouchee_id AS person_id
        FROM vouches
        WHERE voucher_id = $1
          AND (($2::int IS NOT NULL AND job_function_id = $2)
            OR ($2::int IS NULL AND job_function_id IN (SELECT fn_id FROM user_functions)))
      ),
      fn_sponsors AS (
        SELECT DISTINCT voucher_id
        FROM vouches
        WHERE vouchee_id = $1
          AND (($2::int IS NOT NULL AND job_function_id = $2)
            OR ($2::int IS NULL AND job_function_id IN (SELECT fn_id FROM user_functions)))
      ),
      fn_siblings AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM fn_sponsors s
        JOIN vouches v ON v.voucher_id = s.voucher_id
          AND (($2::int IS NOT NULL AND job_function_id = $2)
            OR ($2::int IS NULL AND job_function_id IN (SELECT fn_id FROM user_functions)))
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM fn_degree1)
      ),
      fn_degree2_direct AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM fn_degree1 d1
        JOIN vouches v ON v.voucher_id = d1.person_id
          AND (($2::int IS NOT NULL AND job_function_id = $2)
            OR ($2::int IS NULL AND job_function_id IN (SELECT fn_id FROM user_functions)))
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM fn_degree1)
      ),
      fn_degree2 AS (
        SELECT person_id FROM fn_degree2_direct
        UNION
        SELECT person_id FROM fn_siblings
      ),
      fn_degree3 AS (
        SELECT DISTINCT v.vouchee_id AS person_id
        FROM fn_degree2 d2
        JOIN vouches v ON v.voucher_id = d2.person_id
          AND (($2::int IS NOT NULL AND job_function_id = $2)
            OR ($2::int IS NULL AND job_function_id IN (SELECT fn_id FROM user_functions)))
        WHERE v.vouchee_id != $1
          AND v.vouchee_id NOT IN (SELECT person_id FROM fn_degree1)
          AND v.vouchee_id NOT IN (SELECT person_id FROM fn_degree2)
      ),
      fn_reachable AS (
        SELECT person_id FROM fn_degree1
        UNION
        SELECT person_id FROM fn_degree2
        UNION
        SELECT person_id FROM fn_degree3
      ),

      -- ══════════════════════════════════════════════════════════════════
      -- SCORING & OUTPUT
      -- ══════════════════════════════════════════════════════════════════

      scored AS (
        SELECT
          bd.person_id,
          bd.degree,
          bd.is_sibling,
          CASE
            WHEN bd.person_id IN (SELECT person_id FROM fn_reachable) THEN FALSE
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
        p.current_title,
        p.current_company,
        p.photo_url,
        s.degree,
        s.is_sibling,
        s.is_cross_function,
        s.recommendation_count,
        ROUND(dc.coefficient * s.recommendation_count
          * CASE WHEN s.is_sibling THEN $4 ELSE 1.0 END
          * CASE WHEN s.is_cross_function THEN $3 ELSE 1.0 END, 3) AS vouch_score
    FROM scored s
    JOIN people p ON p.id = s.person_id
    JOIN degree_coefficients dc ON dc.degree = s.degree
    WHERE s.recommendation_count > 0
    ORDER BY vouch_score DESC, s.degree ASC, p.display_name ASC
  `, [userId, jobFunctionId, crossFunctionDiscount, siblingCoefficient])

  return result.rows.filter(r => r.degree <= maxDegree)
}
