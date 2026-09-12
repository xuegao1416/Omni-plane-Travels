-- BEGIN overview
SELECT
  COUNT(*)                                                            AS sessions,
  SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END)                      AS new_users,
  SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END)                      AS returning_users,
  SUM(CASE WHEN max_depth = 'game' THEN 1 ELSE 0 END)                 AS game_sessions,
  ROUND(SUM(duration_ms) / 3600000.0, 2)                              AS total_hours,
  ROUND(AVG(duration_ms) / 60000.0, 2)                                AS avg_minutes,
  ROUND(MIN(duration_ms) / 60000.0, 2)                                AS min_minutes,
  ROUND(MAX(duration_ms) / 60000.0, 2)                                AS max_minutes,
  date(min(started_at) / 1000, 'unixepoch', '+8 hours')               AS first_day,
  date(max(started_at) / 1000, 'unixepoch', '+8 hours')               AS last_day
FROM play_sessions;
-- END

-- BEGIN daily_trend
SELECT
  date(started_at / 1000, 'unixepoch', '+8 hours')                    AS day,
  COUNT(*)                                                            AS sessions,
  SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END)                      AS new_users,
  SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END)                      AS returning_users,
  SUM(CASE WHEN max_depth = 'game' THEN 1 ELSE 0 END)                 AS game_sessions,
  ROUND(SUM(duration_ms) / 3600000.0, 2)                              AS total_hours,
  ROUND(AVG(duration_ms) / 60000.0, 2)                                AS avg_minutes
FROM play_sessions
GROUP BY day
ORDER BY day ASC;
-- END

-- BEGIN daily_conv
SELECT
  day,
  sessions,
  ROUND(100.0 * game_sessions / sessions, 2)                          AS game_rate_pct,
  ROUND(100.0 * returning_users / sessions, 2)                        AS return_rate_pct,
  avg_minutes
FROM (
  SELECT
    date(started_at / 1000, 'unixepoch', '+8 hours')                  AS day,
    COUNT(*)                                                          AS sessions,
    SUM(CASE WHEN max_depth = 'game' THEN 1 ELSE 0 END)               AS game_sessions,
    SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END)                    AS returning_users,
    ROUND(AVG(duration_ms) / 60000.0, 2)                              AS avg_minutes
  FROM play_sessions
  GROUP BY day
)
ORDER BY day ASC;
-- END

-- BEGIN funnel
SELECT
  max_depth,
  COUNT(*)                                                            AS sessions
FROM play_sessions
GROUP BY max_depth
ORDER BY CASE max_depth
  WHEN 'home'   THEN 1
  WHEN 'lobby'  THEN 2
  WHEN 'events' THEN 3
  WHEN 'wizard' THEN 4
  WHEN 'game'   THEN 5
  ELSE 99 END;
-- END

-- BEGIN browsers
SELECT
  browser_family                                                     AS browser,
  COUNT(*)                                                           AS sessions,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM play_sessions), 2) AS pct
FROM play_sessions
GROUP BY browser_family
ORDER BY sessions DESC;
-- END

-- BEGIN screens
SELECT
  screen_size                                                        AS screen,
  COUNT(*)                                                           AS sessions
FROM play_sessions
GROUP BY screen_size
ORDER BY sessions DESC
LIMIT 10;
-- END

-- BEGIN timezones
SELECT
  timezone,
  COUNT(*)                                                           AS sessions,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM play_sessions), 2) AS pct
FROM play_sessions
GROUP BY timezone
ORDER BY sessions DESC
LIMIT 12;
-- END

-- BEGIN duration
SELECT
  SUM(CASE WHEN duration_ms < 60000                       THEN 1 ELSE 0 END) AS under_1m,
  SUM(CASE WHEN duration_ms >= 60000  AND duration_ms < 300000  THEN 1 ELSE 0 END) AS m1_5,
  SUM(CASE WHEN duration_ms >= 300000 AND duration_ms < 900000  THEN 1 ELSE 0 END) AS m5_15,
  SUM(CASE WHEN duration_ms >= 900000 AND duration_ms < 1800000 THEN 1 ELSE 0 END) AS m15_30,
  SUM(CASE WHEN duration_ms >= 1800000 AND duration_ms < 3600000 THEN 1 ELSE 0 END) AS m30_60,
  SUM(CASE WHEN duration_ms >= 3600000                     THEN 1 ELSE 0 END) AS over_1h
FROM play_sessions;
-- END

-- BEGIN hourly_heat
SELECT
  CAST(strftime('%H', started_at / 1000, 'unixepoch', '+8 hours') AS INTEGER) AS hour_of_day,
  COUNT(*)                                                           AS sessions
FROM play_sessions
GROUP BY hour_of_day
ORDER BY hour_of_day ASC;
-- END

-- BEGIN last24
SELECT
  datetime((started_at / 1000 / 3600) * 3600, 'unixepoch', '+8 hours')        AS hour,
  COUNT(*)                                                           AS sessions,
  SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END)                      AS new_users,
  SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END)                      AS returning_users,
  SUM(CASE WHEN max_depth = 'game' THEN 1 ELSE 0 END)                 AS game_sessions,
  ROUND(AVG(duration_ms) / 60000.0, 2)                                AS avg_minutes
FROM play_sessions
WHERE started_at >= strftime('%s', 'now', '-24 hours') * 1000
GROUP BY hour
ORDER BY hour ASC;
-- END

-- BEGIN bounce
SELECT
  COUNT(*)                                                           AS total,
  SUM(CASE WHEN max_depth = 'home' THEN 1 ELSE 0 END)                AS home_only,
  SUM(CASE WHEN max_depth = 'home' AND duration_ms < 60000 THEN 1 ELSE 0 END) AS bounce
FROM play_sessions;
-- END
