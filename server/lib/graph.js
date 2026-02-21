import { query } from './db.js'

/**
 * Get talent recommendations for a user, scored by degree and recommendation count.
 *
 * Degree definitions (from user's perspective):
 *   1st degree (2 hops): User --NETWORK--> X --VOUCH--> Talent
 *   2nd degree (3 hops): User --NETWORK--> X --{N|V}--> Y --VOUCH--> Talent
 *   3rd degree (4 hops): User --NETWORK--> X --{N|V}--> Y --{N|V}--> Z --VOUCH--> Talent
 *
 * Score: degree_coefficient[degree] * recommendation_count
 *   - recommendation_count = distinct paths reaching talent at the best (closest) degree
 *   - If same talent reachable at multiple degrees, uses the closest degree
 *
 * @param {number} userId - people.id of the user
 * @returns {Array<{id, display_name, linkedin_url, email, degree, recommendation_count, vouch_score}>}
 */
export async function getTalentRecommendations(userId) {
  const result = await query(`
    WITH RECURSIVE traversal AS (
        -- Base case: direct network connections from the user (hop 1)
        SELECT
            e.target_id AS current_node,
            e.edge_type AS last_edge_type,
            1 AS hops,
            ARRAY[e.source_id, e.target_id] AS path
        FROM edges e
        WHERE e.source_id = $1
          AND e.edge_type = 'network'

        UNION ALL

        -- Recursive case: follow edges from current nodes
        SELECT
            e.target_id,
            e.edge_type,
            t.hops + 1,
            t.path || e.target_id
        FROM traversal t
        JOIN edges e ON e.source_id = t.current_node
        WHERE t.hops < 4
          AND NOT (e.target_id = ANY(t.path))
    ),

    -- Only paths ending in a VOUCH edge are talent recommendations
    talent_paths AS (
        SELECT
            current_node AS talent_id,
            CASE
                WHEN hops = 2 THEN 1
                WHEN hops = 3 THEN 2
                WHEN hops = 4 THEN 3
            END AS degree
        FROM traversal
        WHERE last_edge_type = 'vouch'
          AND hops >= 2
          AND current_node != $1
    ),

    -- Find best degree per talent, count paths at that degree
    talent_best_degree AS (
        SELECT talent_id, MIN(degree) AS best_degree
        FROM talent_paths
        GROUP BY talent_id
    ),

    talent_scored AS (
        SELECT
            tp.talent_id,
            tbd.best_degree,
            COUNT(*) AS recommendation_count
        FROM talent_paths tp
        JOIN talent_best_degree tbd
          ON tbd.talent_id = tp.talent_id
         AND tbd.best_degree = tp.degree
        GROUP BY tp.talent_id, tbd.best_degree
    )

    SELECT
        p.id,
        p.display_name,
        p.linkedin_url,
        p.email,
        ts.best_degree AS degree,
        ts.recommendation_count,
        ROUND(dc.coefficient * ts.recommendation_count, 3) AS vouch_score
    FROM talent_scored ts
    JOIN people p ON p.id = ts.talent_id
    JOIN degree_coefficients dc ON dc.degree = ts.best_degree
    ORDER BY vouch_score DESC, ts.best_degree ASC, p.display_name ASC
  `, [userId])

  return result.rows
}
