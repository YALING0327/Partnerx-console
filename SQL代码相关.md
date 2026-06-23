# SQL代码相关

# 仅查看主播数据

## Credits 余额

```plaintext
SELECT 
    account_id AS 用户ID,
    COALESCE(CAST(properties['credits'] AS DOUBLE), 0) * 10 AS credits_balance
FROM user
WHERE account_id IN (
    223779302, 223790990, 223822614, 223826213, 224167764, 223779869, 224167605, 224171211,
    223786065, 223810538, 224215898, 224492642, 224476020, 224272546, 224536260, 224270650,
    224676307, 224770841, 224954982, 224705707, 225011185, 226499691, 227516962, 228014432,
    227621889, 228030220, 223781703, 228091225, 228097711, 228099828, 228114827, 228406371,
    228389847, 228101625, 228492026, 228535763, 224295007, 228557794, 228594420, 229128563,
    229641352, 230154022, 206256265
)
ORDER BY account_id;
```

## 主播ID-在麦时长-游戏房直播时长-语音房直播时长-总时长-有效天数（房主直播2小时+匹配/游戏5次）-Credits收入-匹配参与次数-游戏参与次数

```plaintext
WITH anchor_list AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
      AND account_id IN (
          195152369,195159222,195149651,195150515,195163320,195153394,195152583,195147779,195178678,195150912,195171433,195166363,195152727,208901269,195185858,209762491,215281858,215326384,215308445,215294549,224107318,224138630,230745745,229109617,229949418,229094783,232899324,227078263,233829203,233839611,234724439,195355382,237480732,235352519,238669460
      )
),
a AS (
    SELECT
        account_id,
        SUM(CAST(properties['duration'] AS INT)) / 3600.0 AS 在麦时长_小时
    FROM e_room_vm_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
b AS (
    SELECT
        account_id,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS 总直播时长_小时,
        SUM(CAST(properties['game_duration'] AS INT)) / 3600.0 AS 游戏房直播时长_小时
    FROM e_video_room_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
c AS (
    SELECT
        account_id,
        SUM(CAST(properties['prop_change_real'] AS FLOAT)) * 10 AS echo_credit收入
    FROM prop
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND account_id IN (SELECT account_id FROM anchor_list)
      AND properties['prop_name_new'] = 'Credits'
      AND CAST(properties['prop_change_real'] AS FLOAT) > 0
    GROUP BY account_id
),
-- 每日直播时长
daily_live_duration AS (
    SELECT
        account_id,
        DATE(event_created_time) AS dt,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS daily_live_hours
    FROM e_video_room_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id, DATE(event_created_time)
),
-- 每日匹配成功次数（以匹配对计数，需要 /2，且只统计通话时长≥60秒）
daily_match_success AS (
    SELECT 
        DATE(event_created_time) AS dt,
        account_id,
        COUNT(*) AS raw_cnt
    FROM e_echo_match_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY DATE(event_created_time), account_id
    UNION ALL
    SELECT 
        DATE(event_created_time),
        account_id,
        COUNT(*)
    FROM e_echo_match_record_temp
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY DATE(event_created_time), account_id
),
daily_match_total AS (
    SELECT dt, account_id, SUM(raw_cnt) / 2 AS match_cnt
    FROM daily_match_success
    GROUP BY dt, account_id
),
-- 每日游戏参与次数（每个事件中主播作为参与者计一次，不需要除2）
daily_game_play AS (
    SELECT
        DATE(g.event_created_time) AS dt,
        user_id AS account_id,
        COUNT(*) AS game_cnt
    FROM e_echo_luk_game_record g
    LATERAL VIEW EXPLODE(CAST(JSON_EXTRACT(properties, '$.user_ids') AS ARRAY<BIGINT>)) t AS user_id
    WHERE g.event_created_time >= '2026-06-01' AND g.event_created_time < '2026-06-15'
      AND user_id IN (SELECT account_id FROM anchor_list)
    GROUP BY DATE(g.event_created_time), user_id
),
-- 合并条件：直播≥2小时 且 (匹配次数+游戏次数 ≥5)
daily_valid AS (
    SELECT 
        COALESCE(l.account_id, m.account_id, p.account_id) AS account_id,
        COALESCE(l.dt, m.dt, p.dt) AS dt,
        COALESCE(l.daily_live_hours, 0) AS live_hours,
        COALESCE(m.match_cnt, 0) AS match_cnt,
        COALESCE(p.game_cnt, 0) AS game_cnt
    FROM daily_live_duration l
    FULL OUTER JOIN daily_match_total m ON l.account_id = m.account_id AND l.dt = m.dt
    FULL OUTER JOIN daily_game_play p ON COALESCE(l.account_id, m.account_id) = p.account_id AND COALESCE(l.dt, m.dt) = p.dt
),
valid_days AS (
    SELECT 
        account_id,
        COUNT(DISTINCT dt) AS 有效天数
    FROM daily_valid
    WHERE live_hours >= 2
      AND (match_cnt + game_cnt) >= 5
    GROUP BY account_id
),
-- 以下 match_total, game_play_count 保持不变（用于最终输出，但不影响有效天数）
match_success AS (
    SELECT account_id, COUNT(*) AS 匹配成功次数
    FROM e_echo_match_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
    UNION ALL
    SELECT account_id, COUNT(*)
    FROM e_echo_match_record_temp
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-15'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
match_total AS (
    SELECT account_id, SUM(匹配成功次数) AS 匹配成功次数
    FROM match_success
    GROUP BY account_id
),
game_participants AS (
    SELECT
        g.account_id,
        user_id
    FROM e_echo_luk_game_record g
    LATERAL VIEW EXPLODE(CAST(JSON_EXTRACT(properties, '$.user_ids') AS ARRAY<BIGINT>)) t AS user_id
    WHERE g.event_created_time >= '2026-06-01' AND g.event_created_time < '2026-06-15'
      AND user_id IN (SELECT account_id FROM anchor_list)
),
game_play_count AS (
    SELECT
        user_id AS account_id,
        COUNT(*) AS 游戏参与次数
    FROM game_participants
    GROUP BY user_id
)
SELECT
    al.account_id AS 主播ID,
    COALESCE(a.在麦时长_小时, 0) AS 在麦时长_小时,
    COALESCE(b.游戏房直播时长_小时, 0) AS 游戏房直播时长_小时,
    COALESCE(b.总直播时长_小时, 0) - COALESCE(b.游戏房直播时长_小时, 0) AS 语音房直播时长_小时,
    COALESCE(a.在麦时长_小时, 0) + COALESCE(b.总直播时长_小时, 0) AS 总时长_小时,
    COALESCE(vd.有效天数, 0) AS 有效天数,
    COALESCE(c.echo_credit收入, 0) AS Credits收入,
    COALESCE(mt.匹配成功次数, 0) AS 匹配成功次数,
    COALESCE(gp.游戏参与次数, 0) AS 游戏参与次数
FROM anchor_list al
LEFT JOIN a ON al.account_id = a.account_id
LEFT JOIN b ON al.account_id = b.account_id
LEFT JOIN c ON al.account_id = c.account_id
LEFT JOIN valid_days vd ON al.account_id = vd.account_id
LEFT JOIN match_total mt ON al.account_id = mt.account_id
LEFT JOIN game_play_count gp ON al.account_id = gp.account_id
ORDER BY 总时长_小时 DESC;
```

> 有效天数=主播一天内直播≥2h

```plaintext
WITH anchor_list AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
      AND account_id IN (
          206202413,206240409,206249706,206265585,206318371,206321390,206355258,206689648,206691112,219688273,228535763,229504564,229557672,242686460,242747781,242750210,242751659,242759854,242760425,242764868,242765150,242765636,242773159,242773346,242775933,242776245,242778720,242778863,242782337,242782947,242785474,242788110,242788422,242788774,242792636,242804659,242804665,242808824,242811553,242820144,242822376,242822953,242835878,242887298,242889769,242893164,242897955,242902295,242905528,242911316,242912194,242914259,242983074,243014686,243380463
      )
),
a AS (
    SELECT
        account_id,
        SUM(CAST(properties['duration'] AS INT)) / 3600.0 AS 在麦时长_小时
    FROM e_room_vm_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-08'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
b AS (
    SELECT
        account_id,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS 总直播时长_小时,
        SUM(CAST(properties['game_duration'] AS INT)) / 3600.0 AS 游戏房直播时长_小时
    FROM e_video_room_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-08'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
c AS (
    SELECT
        account_id,
        SUM(CAST(properties['prop_change_real'] AS FLOAT)) * 10 AS echo_credit收入
    FROM prop
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-08'
      AND account_id IN (SELECT account_id FROM anchor_list)
      AND properties['prop_name_new'] = 'Credits'
      AND CAST(properties['prop_change_real'] AS FLOAT) > 0
    GROUP BY account_id
),
daily_live_duration AS (
    SELECT
        account_id,
        DATE(event_created_time) AS dt,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS daily_live_hours
    FROM e_video_room_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-08'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id, DATE(event_created_time)
),
valid_days AS (
    SELECT account_id, COUNT(DISTINCT dt) AS 有效天数
    FROM daily_live_duration
    WHERE daily_live_hours >= 2
    GROUP BY account_id
),
match_success AS (
    SELECT account_id, COUNT(*) AS 匹配成功次数
    FROM e_echo_match_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-08'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
    UNION ALL
    SELECT account_id, COUNT(*)
    FROM e_echo_match_record_temp
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-08'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
match_total AS (
    SELECT account_id, SUM(匹配成功次数) AS 匹配成功次数
    FROM match_success
    GROUP BY account_id
),
game_participants AS (
    SELECT
        g.account_id,
        user_id
    FROM e_echo_luk_game_record g
    LATERAL VIEW EXPLODE(CAST(JSON_EXTRACT(properties, '$.user_ids') AS ARRAY<BIGINT>)) t AS user_id
    WHERE g.event_created_time >= '2026-06-01' AND g.event_created_time < '2026-06-08'
      AND user_id IN (SELECT account_id FROM anchor_list)
),
game_play_count AS (
    SELECT
        user_id AS account_id,
        COUNT(*) AS 游戏参与次数
    FROM game_participants
    GROUP BY user_id
)
SELECT
    al.account_id AS 主播ID,
    COALESCE(a.在麦时长_小时, 0) AS 在麦时长_小时,
    COALESCE(b.游戏房直播时长_小时, 0) AS 游戏房直播时长_小时,
    COALESCE(b.总直播时长_小时, 0) - COALESCE(b.游戏房直播时长_小时, 0) AS 语音房直播时长_小时,
    COALESCE(a.在麦时长_小时, 0) + COALESCE(b.总直播时长_小时, 0) AS 总时长_小时,
    COALESCE(vd.有效天数, 0) AS 有效天数,
    COALESCE(c.echo_credit收入, 0) AS Credits收入,
    COALESCE(mt.匹配成功次数, 0) AS 匹配成功次数,
    COALESCE(gp.游戏参与次数, 0) AS 游戏参与次数
FROM anchor_list al
LEFT JOIN a ON al.account_id = a.account_id
LEFT JOIN b ON al.account_id = b.account_id
LEFT JOIN c ON al.account_id = c.account_id
LEFT JOIN valid_days vd ON al.account_id = vd.account_id
LEFT JOIN match_total mt ON al.account_id = mt.account_id
LEFT JOIN game_play_count gp ON al.account_id = gp.account_id
ORDER BY 总时长_小时 DESC;
```

## 主播ID-在麦时长-直播时长-总时长- Credits收入

```plaintext
with a as (select
  account_id,sum(cast(properties['duration'] as int))/3600.0 在麦时长_小时
from
  e_room_vm_record
where
  event_created_month = 2605
  and account_id in (
    206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363, 206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639, 206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986, 206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744, 206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236, 206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390, 206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313, 206319253
    
  )
  and event_created_time >= '2026-05-01'
  and event_created_time < '2026-05-08'
  group by account_id),

b as (select
  account_id,sum(cast(properties['live_duration'] as int))/3600.0 直播时长_小时
from
  e_video_room_record
where
  event_created_month = 2605
  and account_id in (   
    206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363, 206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639, 206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986, 206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744, 206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236, 206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390, 206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313, 206319253
  )
  and event_created_time >= '2026-05-01'
  and event_created_time < '2026-05-08'
  group by account_id),
  c as (select
  account_id,sum(cast(properties['prop_change_real'] as float))*10 echo_credit收入
from
  prop
where
  event_created_month = 2605
  and account_id in (
    206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363, 206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639, 206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986, 206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744, 206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236, 206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390, 206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313, 206319253
  )
  and event_created_time >= '2026-05-01'
  and event_created_time < '2026-05-08'
  and properties['prop_name_new']='Credits'
  and cast(properties['prop_change_real'] as float)>0
  group by account_id)

  select COALESCE(a.account_id,b.account_id) uid,
  COALESCE(在麦时长_小时,0) 在麦时长_小时,
  COALESCE(直播时长_小时,0) 直播时长_小时,
  COALESCE(在麦时长_小时,0)+COALESCE(直播时长_小时,0) 总时长,
  COALESCE(echo_credit收入,0) echo_credit收入
  from a 
  FULL OUTER join b on a.account_id=b.account_id
  FULL OUTER join c on COALESCE(a.account_id,b.account_id)=c.account_id
  order by 总时长
```

## 主播ID-在麦时长-游戏房直播时长-语音房直播时长-总时长- Credits收入

```plaintext
WITH 
-- 在麦时长（不变）
a AS (
    SELECT
        account_id,
        SUM(CAST(properties['duration'] AS INT)) / 3600.0 AS 在麦时长_小时
    FROM e_room_vm_record
    WHERE event_created_month = 2605
      AND account_id IN (
          206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363,
          206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639,
          206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986,
          206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744,
          206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236,
          206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390,
          206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313,
          206319253
      )
      AND event_created_time >= '2026-05-10'
      AND event_created_time < '2026-05-26'
    GROUP BY account_id
),
-- 直播时长拆分：游戏房直播时长（game_duration）和总直播时长（live_duration）
b AS (
    SELECT
        account_id,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS 总直播时长_小时,
        SUM(CAST(properties['game_duration'] AS INT)) / 3600.0 AS 游戏房直播时长_小时
    FROM e_video_room_record
    WHERE event_created_month = 2605
      AND account_id IN (
          206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363,
          206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639,
          206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986,
          206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744,
          206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236,
          206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390,
          206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313,
          206319253
      )
      AND event_created_time >= '2026-05-10'
      AND event_created_time < '2026-05-26'
    GROUP BY account_id
),
-- Credits 收入（不变）
c AS (
    SELECT
        account_id,
        SUM(CAST(properties['prop_change_real'] AS FLOAT)) * 10 AS echo_credit收入
    FROM prop
    WHERE event_created_month = 2605
      AND account_id IN (
          206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363,
          206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639,
          206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986,
          206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744,
          206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236,
          206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390,
          206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313,
          206319253
      )
      AND event_created_time >= '2026-05-10'
      AND event_created_time < '2026-05-26'
      AND properties['prop_name_new'] = 'Credits'
      AND CAST(properties['prop_change_real'] AS FLOAT) > 0
    GROUP BY account_id
)
SELECT
    COALESCE(a.account_id, b.account_id, c.account_id) AS uid,
    COALESCE(a.在麦时长_小时, 0) AS 在麦时长_小时,
    COALESCE(b.游戏房直播时长_小时, 0) AS 游戏房直播时长_小时,
    COALESCE(b.总直播时长_小时, 0) - COALESCE(b.游戏房直播时长_小时, 0) AS 语音房直播时长_小时,
    COALESCE(a.在麦时长_小时, 0) + COALESCE(b.总直播时长_小时, 0) AS 总时长_小时,   -- 注意：总时长 = 在麦时长 + 所有直播时长
    COALESCE(c.echo_credit收入, 0) AS echo_credit收入
FROM a
FULL OUTER JOIN b ON a.account_id = b.account_id
FULL OUTER JOIN c ON COALESCE(a.account_id, b.account_id) = c.account_id
ORDER BY 总时长_小时;
```

## 主播ID-主动私聊用户数-回复主播用户数-被搭讪用户数-回复搭讪用户数-主播有效私聊用户数

```plaintext
-- ============================================================
-- 主播列表（50个ID）
-- ============================================================
WITH anchor_list AS (
    SELECT 206268175 AS anchor_id UNION ALL
    SELECT 211971372 UNION ALL
    SELECT 206248984 UNION ALL
    SELECT 206675971 UNION ALL
    SELECT 206578017 UNION ALL
    SELECT 206304281 UNION ALL
    SELECT 206335363 UNION ALL
    SELECT 206265585 UNION ALL
    SELECT 206592341 UNION ALL
    SELECT 206676346 UNION ALL
    SELECT 209342510 UNION ALL
    SELECT 207360683 UNION ALL
    SELECT 211526066 UNION ALL
    SELECT 211840639 UNION ALL
    SELECT 206919982 UNION ALL
    SELECT 206689648 UNION ALL
    SELECT 207021070 UNION ALL
    SELECT 206838094 UNION ALL
    SELECT 206271522 UNION ALL
    SELECT 206575378 UNION ALL
    SELECT 206922986 UNION ALL
    SELECT 206265115 UNION ALL
    SELECT 206344034 UNION ALL
    SELECT 206631588 UNION ALL
    SELECT 206319075 UNION ALL
    SELECT 206994735 UNION ALL
    SELECT 206318371 UNION ALL
    SELECT 206676744 UNION ALL
    SELECT 206291740 UNION ALL
    SELECT 206321537 UNION ALL
    SELECT 206231326 UNION ALL
    SELECT 206355258 UNION ALL
    SELECT 206202413 UNION ALL
    SELECT 206240409 UNION ALL
    SELECT 207032236 UNION ALL
    SELECT 206329775 UNION ALL
    SELECT 206347829 UNION ALL
    SELECT 206310744 UNION ALL
    SELECT 206251779 UNION ALL
    SELECT 206249706 UNION ALL
    SELECT 206691112 UNION ALL
    SELECT 206321390 UNION ALL
    SELECT 206278894 UNION ALL
    SELECT 206337619 UNION ALL
    SELECT 206337128 UNION ALL
    SELECT 206244668 UNION ALL
    SELECT 206226432 UNION ALL
    SELECT 206245381 UNION ALL
    SELECT 206262313 UNION ALL
    SELECT 206319253
),

-- ============================================================
-- 有效私聊消息（时间范围：5.1-5.7，场景和类型过滤，带时间）
-- ============================================================
valid_msgs AS (
    SELECT
        account_id AS from_user,
        CAST(properties['target_id'] AS BIGINT) AS to_user,
        event_created_time
    FROM e_immsg
    WHERE (CAST(properties['scene'] AS INT) NOT IN (1,11,14,13,16,4005,12,15) OR properties['scene'] IS NULL)
      AND CAST(properties['im_msg_info']['message_type'] AS INT) IN (6, -1, 0, 2)
      AND account_id != CAST(properties['target_id'] AS BIGINT)
      AND event_created_time >= '2026-05-9'
      AND event_created_time < '2026-05-14'
),

-- ============================================================
-- 1. 主动私聊用户数（不分时间差，仅主播主动发过消息的用户）
-- ============================================================
anchor_send AS (
    SELECT DISTINCT
        v.from_user AS anchor_id,
        v.to_user AS user_id
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id
),
initiative AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS active_send_uv
    FROM anchor_send
    GROUP BY anchor_id
),

-- ============================================================
-- 2. 被回复用户数（主播主动发消息后，用户在该消息24小时内回复）
--    使用 EXISTS 判断：存在主播给用户的某条消息，之后24小时内有用户给主播的消息
-- ============================================================
anchor_send_with_time AS (
    SELECT v.from_user AS anchor_id, v.to_user AS user_id, v.event_created_time AS send_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id
),
user_reply_within_24h AS (
    SELECT DISTINCT
        s.anchor_id,
        s.user_id
    FROM anchor_send_with_time s
    JOIN valid_msgs r ON r.from_user = s.user_id AND r.to_user = s.anchor_id
    WHERE r.event_created_time BETWEEN s.send_time AND DATE_ADD(s.send_time, INTERVAL 24 HOUR)
),
replied_after_send AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS replied_uv
    FROM user_reply_within_24h
    GROUP BY anchor_id
),

-- ============================================================
-- 3. 被搭讪用户数（用户主动发给主播，不分时间差）
-- ============================================================
user_to_anchor AS (
    SELECT DISTINCT
        v.to_user AS anchor_id,
        v.from_user AS user_id
    FROM valid_msgs v
    JOIN anchor_list a ON v.to_user = a.anchor_id
),
received AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS received_uv
    FROM user_to_anchor
    GROUP BY anchor_id
),

-- ============================================================
-- 4. 回复搭讪用户数（用户主动发消息后，主播在24小时内回复）
-- ============================================================
user_send_with_time AS (
    SELECT v.to_user AS anchor_id, v.from_user AS user_id, v.event_created_time AS user_send_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.to_user = a.anchor_id
),
anchor_reply_within_24h AS (
    SELECT DISTINCT
        s.anchor_id,
        s.user_id
    FROM user_send_with_time s
    JOIN valid_msgs r ON r.from_user = s.anchor_id AND r.to_user = s.user_id
    WHERE r.event_created_time BETWEEN s.user_send_time AND DATE_ADD(s.user_send_time, INTERVAL 24 HOUR)
),
replied_to_user AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS reply_uv
    FROM anchor_reply_within_24h
    GROUP BY anchor_id
),

-- ============================================================
-- 5. 主播有效私聊用户数（24小时内3个回合以上）
-- ============================================================
msg_anchor_user AS (
    SELECT
        v.from_user,
        v.to_user,
        a.anchor_id,
        CASE WHEN v.from_user = a.anchor_id THEN v.to_user ELSE v.from_user END AS user_id,
        CASE WHEN v.from_user = a.anchor_id THEN 1 ELSE 0 END AS is_anchor_msg,
        v.event_created_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id OR v.to_user = a.anchor_id
    WHERE v.from_user != v.to_user
),
pair_stats AS (
    SELECT
        anchor_id,
        user_id,
        COUNT(*) AS total_msgs,
        SUM(is_anchor_msg) AS anchor_msgs,
        COUNT(*) - SUM(is_anchor_msg) AS user_msgs,
        MIN(event_created_time) AS first_msg_time,
        MAX(event_created_time) AS last_msg_time
    FROM msg_anchor_user
    GROUP BY anchor_id, user_id
    HAVING total_msgs >= 6
       AND anchor_msgs >= 3
       AND user_msgs >= 3
       AND TIMESTAMPDIFF(HOUR, first_msg_time, last_msg_time) <= 24
),
valid_chat AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS valid_uv
    FROM pair_stats
    GROUP BY anchor_id
)

-- ============================================================
-- 最终输出：所有主播（含0值）
-- ============================================================
SELECT
    a.anchor_id AS 主播id,
    COALESCE(i.active_send_uv, 0) AS 主动私聊用户数,
    COALESCE(rp.replied_uv, 0) AS 回复主播用户数,
    COALESCE(rec.received_uv, 0) AS 被搭讪用户数,
    COALESCE(rep.reply_uv, 0) AS 回复搭讪用户数,
    COALESCE(vc.valid_uv, 0) AS 主播有效私聊用户数
FROM anchor_list a
LEFT JOIN initiative i ON a.anchor_id = i.anchor_id
LEFT JOIN replied_after_send rp ON a.anchor_id = rp.anchor_id
LEFT JOIN received rec ON a.anchor_id = rec.anchor_id
LEFT JOIN replied_to_user rep ON a.anchor_id = rep.anchor_id
LEFT JOIN valid_chat vc ON a.anchor_id = vc.anchor_id
ORDER BY a.anchor_id;
```

剔除主播

```plaintext
-- ============================================================
-- 主播列表（需要统计的ID，共约76个）
-- ============================================================
WITH anchor_list AS (
    SELECT 206202413 AS anchor_id UNION ALL
    SELECT 206226432 UNION ALL
    SELECT 206231326 UNION ALL
    SELECT 206240409 UNION ALL
    SELECT 206244668 UNION ALL
    SELECT 206245381 UNION ALL
    SELECT 206248984 UNION ALL
    SELECT 206262313 UNION ALL
    SELECT 206265115 UNION ALL
    SELECT 206265585 UNION ALL
    SELECT 206268175 UNION ALL
    SELECT 206271522 UNION ALL
    SELECT 206278894 UNION ALL
    SELECT 206304281 UNION ALL
    SELECT 206310744 UNION ALL
    SELECT 206318371 UNION ALL
    SELECT 206319253 UNION ALL
    SELECT 206321390 UNION ALL
    SELECT 206321537 UNION ALL
    SELECT 206329775 UNION ALL
    SELECT 206337128 UNION ALL
    SELECT 206344034 UNION ALL
    SELECT 206347829 UNION ALL
    SELECT 206575378 UNION ALL
    SELECT 206578017 UNION ALL
    SELECT 206592341 UNION ALL
    SELECT 206631588 UNION ALL
    SELECT 206675971 UNION ALL
    SELECT 206676744 UNION ALL
    SELECT 206689648 UNION ALL
    SELECT 206691112 UNION ALL
    SELECT 206838094 UNION ALL
    SELECT 206919982 UNION ALL
    SELECT 206922986 UNION ALL
    SELECT 207021070 UNION ALL
    SELECT 207032236 UNION ALL
    SELECT 207360683 UNION ALL
    SELECT 209342510 UNION ALL
    SELECT 211526066 UNION ALL
    SELECT 211840639 UNION ALL
    SELECT 211971372 UNION ALL
    SELECT 206355258 UNION ALL
    SELECT 206994735 UNION ALL
    SELECT 206291740 UNION ALL
    SELECT 206249706 UNION ALL
    SELECT 206337619 UNION ALL
    SELECT 223779302 UNION ALL
    SELECT 223790990 UNION ALL
    SELECT 223822614 UNION ALL
    SELECT 224167764 UNION ALL
    SELECT 223779869 UNION ALL
    SELECT 224167605 UNION ALL
    SELECT 224215898 UNION ALL
    SELECT 224476020 UNION ALL
    SELECT 225011185 UNION ALL
    SELECT 226499691 UNION ALL
    SELECT 228014432 UNION ALL
    SELECT 228030220 UNION ALL
    SELECT 223781703 UNION ALL
    SELECT 228091225 UNION ALL
    SELECT 228097711 UNION ALL
    SELECT 228099828 UNION ALL
    SELECT 228114827 UNION ALL
    SELECT 228389847 UNION ALL
    SELECT 228101625 UNION ALL
    SELECT 228492026 UNION ALL
    SELECT 228535763 UNION ALL
    SELECT 224295007 UNION ALL
    SELECT 228557794 UNION ALL
    SELECT 228594420 UNION ALL
    SELECT 206256265 UNION ALL
    SELECT 228406371
),

-- ============================================================
-- 需要排除的用户ID（所有主播ID + 额外提供的ID，避免主播间互聊）
-- ============================================================
excluded_users AS (
    SELECT anchor_id FROM anchor_list
    UNION
    SELECT 195152369 UNION ALL
    SELECT 195159222 UNION ALL
    SELECT 215326384 UNION ALL
    SELECT 209762491 UNION ALL
    SELECT 195150515 UNION ALL
    SELECT 195153394 UNION ALL
    SELECT 195163320 UNION ALL
    SELECT 195147779 UNION ALL
    SELECT 195178678 UNION ALL
    SELECT 195171433 UNION ALL
    SELECT 208910051 UNION ALL
    SELECT 195152727 UNION ALL
    SELECT 208901269 UNION ALL
    SELECT 195185858 UNION ALL
    SELECT 195152583 UNION ALL
    SELECT 215281858 UNION ALL
    SELECT 195149651 UNION ALL
    SELECT 215308445 UNION ALL
    SELECT 215294549 UNION ALL
    SELECT 195150912 UNION ALL
    SELECT 224138630 UNION ALL
    SELECT 224107318
),

-- ============================================================
-- 有效私聊消息（时间范围：5.8-5.14，场景和类型过滤，带时间）
-- ============================================================
valid_msgs AS (
    SELECT
        account_id AS from_user,
        CAST(properties['target_id'] AS BIGINT) AS to_user,
        event_created_time
    FROM e_immsg
    WHERE (CAST(properties['scene'] AS INT) NOT IN (1,11,14,13,16,4005,12,15) OR properties['scene'] IS NULL)
      AND CAST(properties['im_msg_info']['message_type'] AS INT) IN (6, -1, 0, 2)
      AND account_id != CAST(properties['target_id'] AS BIGINT)
      AND event_created_time >= '2026-05-08'
      AND event_created_time < '2026-05-15'
),

-- ============================================================
-- 1. 主动私聊用户数（主播主动发消息，且对方不是主播）
-- ============================================================
anchor_send AS (
    SELECT DISTINCT
        v.from_user AS anchor_id,
        v.to_user AS user_id
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id
    WHERE v.to_user NOT IN (SELECT anchor_id FROM excluded_users)
),
initiative AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS active_send_uv
    FROM anchor_send
    GROUP BY anchor_id
),

-- ============================================================
-- 2. 回复主播用户数（主播主动发消息后，用户在24小时内回复，且用户不是主播）
-- ============================================================
anchor_send_with_time AS (
    SELECT v.from_user AS anchor_id, v.to_user AS user_id, v.event_created_time AS send_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id
    WHERE v.to_user NOT IN (SELECT anchor_id FROM excluded_users)
),
user_reply_within_24h AS (
    SELECT DISTINCT
        s.anchor_id,
        s.user_id
    FROM anchor_send_with_time s
    JOIN valid_msgs r ON r.from_user = s.user_id AND r.to_user = s.anchor_id
    WHERE r.event_created_time BETWEEN s.send_time AND DATE_ADD(s.send_time, INTERVAL 24 HOUR)
      AND r.from_user NOT IN (SELECT anchor_id FROM excluded_users)
),
replied_after_send AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS replied_uv
    FROM user_reply_within_24h
    GROUP BY anchor_id
),

-- ============================================================
-- 3. 被搭讪用户数（用户主动发给主播，且该用户不是主播）
-- ============================================================
user_to_anchor AS (
    SELECT DISTINCT
        v.to_user AS anchor_id,
        v.from_user AS user_id
    FROM valid_msgs v
    JOIN anchor_list a ON v.to_user = a.anchor_id
    WHERE v.from_user NOT IN (SELECT anchor_id FROM excluded_users)
),
received AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS received_uv
    FROM user_to_anchor
    GROUP BY anchor_id
),

-- ============================================================
-- 4. 回复搭讪用户数（用户主动发消息后，主播在24小时内回复，且主动方不是主播）
-- ============================================================
user_send_with_time AS (
    SELECT v.to_user AS anchor_id, v.from_user AS user_id, v.event_created_time AS user_send_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.to_user = a.anchor_id
    WHERE v.from_user NOT IN (SELECT anchor_id FROM excluded_users)
),
anchor_reply_within_24h AS (
    SELECT DISTINCT
        s.anchor_id,
        s.user_id
    FROM user_send_with_time s
    JOIN valid_msgs r ON r.from_user = s.anchor_id AND r.to_user = s.user_id
    WHERE r.event_created_time BETWEEN s.user_send_time AND DATE_ADD(s.user_send_time, INTERVAL 24 HOUR)
),
replied_to_user AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS reply_uv
    FROM anchor_reply_within_24h
    GROUP BY anchor_id
),

-- ============================================================
-- 5. 主播有效私聊用户数（24小时内3个回合以上，且对方不是主播）
-- ============================================================
msg_anchor_user AS (
    SELECT
        v.from_user,
        v.to_user,
        a.anchor_id,
        CASE WHEN v.from_user = a.anchor_id THEN v.to_user ELSE v.from_user END AS user_id,
        CASE WHEN v.from_user = a.anchor_id THEN 1 ELSE 0 END AS is_anchor_msg,
        v.event_created_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id OR v.to_user = a.anchor_id
    WHERE v.from_user != v.to_user
      -- 只保留用户ID不是主播的对话（即对方是非主播）
      AND (CASE WHEN v.from_user = a.anchor_id THEN v.to_user ELSE v.from_user END) NOT IN (SELECT anchor_id FROM excluded_users)
),
pair_stats AS (
    SELECT
        anchor_id,
        user_id,
        COUNT(*) AS total_msgs,
        SUM(is_anchor_msg) AS anchor_msgs,
        COUNT(*) - SUM(is_anchor_msg) AS user_msgs,
        MIN(event_created_time) AS first_msg_time,
        MAX(event_created_time) AS last_msg_time
    FROM msg_anchor_user
    GROUP BY anchor_id, user_id
    HAVING total_msgs >= 6
       AND anchor_msgs >= 3
       AND user_msgs >= 3
       AND TIMESTAMPDIFF(HOUR, first_msg_time, last_msg_time) <= 24
),
valid_chat AS (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS valid_uv
    FROM pair_stats
    GROUP BY anchor_id
)

-- ============================================================
-- 最终输出：所有主播（含0值）
-- ============================================================
SELECT
    a.anchor_id AS 主播id,
    COALESCE(i.active_send_uv, 0) AS 主动私聊用户数,
    COALESCE(rp.replied_uv, 0) AS 回复主播用户数,
    COALESCE(rec.received_uv, 0) AS 被搭讪用户数,
    COALESCE(rep.reply_uv, 0) AS 回复搭讪用户数,
    COALESCE(vc.valid_uv, 0) AS 主播有效私聊用户数
FROM anchor_list a
LEFT JOIN initiative i ON a.anchor_id = i.anchor_id
LEFT JOIN replied_after_send rp ON a.anchor_id = rp.anchor_id
LEFT JOIN received rec ON a.anchor_id = rec.anchor_id
LEFT JOIN replied_to_user rep ON a.anchor_id = rep.anchor_id
LEFT JOIN valid_chat vc ON a.anchor_id = vc.anchor_id
ORDER BY a.anchor_id;
```

## 游戏房最高在线人数

```plaintext
-- 语音房当日最高同时在线人数（基于进出时间计算）
WITH target_anchors AS (
    SELECT account_id FROM user WHERE account_id IN (
        195153394, 233839611, 215308445, 195178678, 224138630, 195185858,
        215326384, 233839611, 215281858, 195150912, 209762491
    )
),
-- 主播每日所开的房间（语音房模式 live_mode=2）
anchor_rooms AS (
    SELECT DISTINCT
        DATE(event_created_time) AS dt,
        account_id,
        CAST(properties['room_id'] AS BIGINT) AS room_id
    FROM e_video_room_record
    WHERE event_created_time >= '2026-05-25' AND event_created_time < '2026-06-01'
      AND CAST(properties['live_mode'] AS CHAR) = '2'
      AND account_id IN (SELECT account_id FROM target_anchors)
),
-- 获取每个房间内用户的进出事件（进入为+1，退出为-1）
room_events AS (
    SELECT
        DATE(exit.event_created_time) AS dt,
        CAST(exit.properties['room_id'] AS BIGINT) AS room_id,
        exit.event_created_time AS ts,
        1 AS delta   -- 进入事件
    FROM e_video_room_user_exit exit
    WHERE exit.event_created_time >= '2026-05-25' AND exit.event_created_time < '2026-06-01'
      AND CAST(exit.properties['live_mode'] AS CHAR) = '2'
    
    UNION ALL
    
    SELECT
        DATE(exit.event_created_time) AS dt,
        CAST(exit.properties['room_id'] AS BIGINT) AS room_id,
        exit.event_created_time + INTERVAL CAST(exit.properties['in_duration'] AS INT) SECOND AS ts,
        -1 AS delta   -- 退出事件
    FROM e_video_room_user_exit exit
    WHERE exit.event_created_time >= '2026-05-25' AND exit.event_created_time < '2026-06-01'
      AND CAST(exit.properties['live_mode'] AS CHAR) = '2'
      AND exit.properties['in_duration'] IS NOT NULL
),
-- 按房间、时间排序，计算累计在线人数
concurrent AS (
    SELECT
        dt,
        room_id,
        ts,
        SUM(delta) OVER (PARTITION BY room_id ORDER BY ts ROWS UNBOUNDED PRECEDING) AS online
    FROM room_events
),
-- 每日每个房间的峰值
peak_per_room AS (
    SELECT
        dt,
        room_id,
        MAX(online) AS peak_online
    FROM concurrent
    GROUP BY dt, room_id
)
-- 关联主播房间，输出结果
SELECT 
    ar.dt AS 日期,
    ar.account_id AS 主播ID,
    ar.room_id AS 房间ID,
    COALESCE(ppr.peak_online, 0) AS 语音房当日最高在线人数
FROM anchor_rooms ar
LEFT JOIN peak_per_room ppr ON ar.dt = ppr.dt AND ar.room_id = ppr.room_id
ORDER BY 日期, 主播ID, 房间ID;
```

## 语音房当日总观众数

```plaintext
-- 语音房每日独立观众数（按房间维度，以UV代替峰值并发）
WITH target_anchors AS (
    SELECT account_id FROM user WHERE account_id IN (
        195153394, 233839611, 215308445, 195178678, 224138630, 195185858,
        215326384, 233839611, 215281858, 195150912, 209762491
    )
),
-- 主播每日所开的房间（语音房模式 live_mode=2）
anchor_rooms AS (
    SELECT DISTINCT
        DATE(event_created_time) AS dt,
        account_id,
        CAST(properties['room_id'] AS BIGINT) AS room_id
    FROM e_video_room_record
    WHERE event_created_time >= '2026-05-25' AND event_created_time < '2026-06-01'
      AND CAST(properties['live_mode'] AS CHAR) = '2'
      AND account_id IN (SELECT account_id FROM target_anchors)
),
-- 每个房间的每日独立观众数（从 e_video_room_user_exit 统计）
room_audience AS (
    SELECT
        DATE(exit.event_created_time) AS dt,
        CAST(exit.properties['room_id'] AS BIGINT) AS room_id,
        COUNT(DISTINCT exit.account_id) AS uv
    FROM e_video_room_user_exit exit
    WHERE exit.event_created_time >= '2026-05-25' AND exit.event_created_time < '2026-06-01'
      AND CAST(exit.properties['live_mode'] AS CHAR) = '2'
    GROUP BY dt, room_id
)
SELECT 
    ar.dt AS 日期,
    ar.account_id AS 主播ID,
    ar.room_id AS 房间ID,
    COALESCE(ra.uv, 0) AS 语音房当日独立观众数
FROM anchor_rooms ar
LEFT JOIN room_audience ra ON ar.dt = ra.dt AND ar.room_id = ra.room_id
ORDER BY 日期, 主播ID, 房间ID;
```

## 游戏房当日参与人数

```plaintext
-- 游戏每日参与人数（按主播、房间、日期统计）
WITH target_anchors AS (
    SELECT account_id FROM user WHERE account_id IN (
        195153394, 233839611, 215308445, 195178678, 224138630, 195185858,
        215326384, 233839611, 215281858, 195150912, 209762491
    )
),
-- 展开游戏事件，获取每个参与用户及其房间ID
game_participants AS (
    SELECT
        DATE(g.event_created_time) AS dt,
        CAST(g.properties['room_id'] AS BIGINT) AS room_id,
        user_id,
        g.account_id AS event_creator   -- 原始事件创建者（可能是房主）
    FROM e_echo_luk_game_record g
    LATERAL VIEW EXPLODE(CAST(JSON_EXTRACT(properties, '$.user_ids') AS ARRAY<BIGINT>)) t AS user_id
    WHERE g.event_created_time >= '2026-05-25' AND g.event_created_time < '2026-06-01'
      AND user_id IN (SELECT account_id FROM target_anchors)   -- 只取主播作为参与者的记录
),
-- 每个主播每日每个房间与其一起玩的其他用户（去重）
game_peers AS (
    SELECT
        dt,
        room_id,
        user_id AS 主播ID,
        COLLECT_SET(other_user) AS peer_list
    FROM (
        SELECT 
            gp.dt,
            gp.room_id,
            gp.user_id,
            other.user_id AS other_user
        FROM game_participants gp
        JOIN game_participants other 
            ON gp.dt = other.dt 
           AND gp.room_id = other.room_id
           AND gp.event_creator = other.event_creator   -- 确保是同一场游戏事件
        WHERE other.user_id != gp.user_id
    ) t
    GROUP BY dt, room_id, user_id
)
SELECT 
    dt AS 日期,
    主播ID,
    room_id AS 房间ID,
    SIZE(peer_list) AS 游戏当日参与人数   -- 去重用户数
FROM game_peers
ORDER BY 日期, 主播ID, 房间ID;
```

## 接收私聊用户数 & 回复用户数

```plaintext
-- 合并查询：收到私聊用户数 + 回复用户数
WITH anchor_list AS (
    SELECT 206268175 AS anchor_id UNION ALL
    SELECT 211971372 UNION ALL
    SELECT 206248984 UNION ALL
    SELECT 206675971 UNION ALL
    SELECT 206578017 UNION ALL
    SELECT 206304281 UNION ALL
    SELECT 206335363 UNION ALL
    SELECT 206265585 UNION ALL
    SELECT 206592341 UNION ALL
    SELECT 206676346 UNION ALL
    SELECT 209342510 UNION ALL
    SELECT 207360683 UNION ALL
    SELECT 211526066 UNION ALL
    SELECT 211840639 UNION ALL
    SELECT 206919982 UNION ALL
    SELECT 206689648 UNION ALL
    SELECT 207021070 UNION ALL
    SELECT 206838094 UNION ALL
    SELECT 206271522 UNION ALL
    SELECT 206575378 UNION ALL
    SELECT 206922986 UNION ALL
    SELECT 206265115 UNION ALL
    SELECT 206344034 UNION ALL
    SELECT 206631588 UNION ALL
    SELECT 206319075 UNION ALL
    SELECT 206994735 UNION ALL
    SELECT 206318371 UNION ALL
    SELECT 206676744 UNION ALL
    SELECT 206291740 UNION ALL
    SELECT 206321537 UNION ALL
    SELECT 206231326 UNION ALL
    SELECT 206355258 UNION ALL
    SELECT 206202413 UNION ALL
    SELECT 206240409 UNION ALL
    SELECT 207032236 UNION ALL
    SELECT 206329775 UNION ALL
    SELECT 206347829 UNION ALL
    SELECT 206310744 UNION ALL
    SELECT 206251779 UNION ALL
    SELECT 206249706 UNION ALL
    SELECT 206691112 UNION ALL
    SELECT 206321390 UNION ALL
    SELECT 206278894 UNION ALL
    SELECT 206337619 UNION ALL
    SELECT 206337128 UNION ALL
    SELECT 206244668 UNION ALL
    SELECT 206226432 UNION ALL
    SELECT 206245381 UNION ALL
    SELECT 206262313 UNION ALL
    SELECT 206319253
),
-- 有效私聊消息（时间 + 场景 + 类型过滤）
valid_msgs AS (
    SELECT
        account_id AS from_user,
        CAST(properties['target_id'] AS BIGINT) AS to_user
    FROM e_immsg
    WHERE (CAST(properties['scene'] AS INT) NOT IN (1,11,14,13,16,4005,12,15) OR properties['scene'] IS NULL)
      AND CAST(properties['im_msg_info']['message_type'] AS INT) IN (6, -1, 0, 2)
      AND account_id != CAST(properties['target_id'] AS BIGINT)
      AND event_created_time >= '2026-04-27'
      AND event_created_time <  '2026-05-02'
),
-- 收到私聊用户数：用户发给主播（去重）
received AS (
    SELECT
        v.to_user AS anchor_id,
        COUNT(DISTINCT v.from_user) AS received_user_count
    FROM valid_msgs v
    JOIN anchor_list a ON v.to_user = a.anchor_id
    GROUP BY v.to_user
),
-- 双向互动对：用户->主播 和 主播->用户
user_to_anchor AS (
    SELECT DISTINCT
        v.to_user AS anchor_id,
        v.from_user AS user_id
    FROM valid_msgs v
    JOIN anchor_list a ON v.to_user = a.anchor_id
),
anchor_to_user AS (
    SELECT DISTINCT
        v.from_user AS anchor_id,
        v.to_user AS user_id
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id
),
-- 回复用户数：双向互动用户的去重计数
replied AS (
    SELECT
        u.anchor_id,
        COUNT(DISTINCT u.user_id) AS replied_user_count
    FROM user_to_anchor u
    JOIN anchor_to_user a ON u.anchor_id = a.anchor_id AND u.user_id = a.user_id
    GROUP BY u.anchor_id
)
-- 最终输出：所有主播（含0值）
SELECT
    a.anchor_id,
    COALESCE(r.received_user_count, 0) AS received_user_count,
    COALESCE(rp.replied_user_count, 0) AS replied_user_count
FROM anchor_list a
LEFT JOIN received r ON a.anchor_id = r.anchor_id
LEFT JOIN replied rp ON a.anchor_id = rp.anchor_id
ORDER BY a.anchor_id;
```

## 主播Credits收益

```plaintext
SELECT
    e.account_id AS anchor_id,
    SUM(CAST(properties['prop_change_real'] AS DOUBLE)) AS credits_income
FROM `prop` e
LEFT JOIN (
    SELECT account_id AS tag_account_id,
           concat_ws(',', collect_list(tag)) AS user_tags
    FROM user_tag
    GROUP BY account_id
) ttg ON e.account_id = ttg.tag_account_id
LEFT JOIN (
    SELECT account_id AS cur_user_id,
           properties AS cur_user
    FROM user
) u ON e.account_id = u.cur_user_id
WHERE CAST(properties['prop_name_new'] AS CHAR) = 'Credits'
  AND CAST(properties['action_name'] AS CHAR) NOT IN ('运营补单', '提现返还', '提现', 'Tokens兑换')
  AND CAST(properties['prop_change_real'] AS DOUBLE) > 0   -- 只统计收入（正值）
  AND e.account_id IN (
      195152369, 195159222, 215326384, 209762491, 195150515, 195153394,
      195163320, 195147779, 195178678, 195171433, 208910051, 195152727,
      208901269, 195185858, 195152583, 215281858, 195149651, 215308445,
      215294549, 195150912, 224138630, 224107318
  )
  AND e.event_created_time >= '2026-04-27'
  AND e.event_created_time <  '2026-05-02'   -- 包含4.27～5.1全天
GROUP BY e.account_id
ORDER BY anchor_id;
```

## 有效聊天用户数

> 24小时内对话3个回合以上

```plaintext
WITH anchor_list AS (
    SELECT 206268175 AS anchor_id UNION ALL
    SELECT 211971372 UNION ALL
    SELECT 206248984 UNION ALL
    SELECT 206675971 UNION ALL
    SELECT 206578017 UNION ALL
    SELECT 206304281 UNION ALL
    SELECT 206335363 UNION ALL
    SELECT 206265585 UNION ALL
    SELECT 206592341 UNION ALL
    SELECT 206676346 UNION ALL
    SELECT 209342510 UNION ALL
    SELECT 207360683 UNION ALL
    SELECT 211526066 UNION ALL
    SELECT 211840639 UNION ALL
    SELECT 206919982 UNION ALL
    SELECT 206689648 UNION ALL
    SELECT 207021070 UNION ALL
    SELECT 206838094 UNION ALL
    SELECT 206271522 UNION ALL
    SELECT 206575378 UNION ALL
    SELECT 206922986 UNION ALL
    SELECT 206265115 UNION ALL
    SELECT 206344034 UNION ALL
    SELECT 206631588 UNION ALL
    SELECT 206319075 UNION ALL
    SELECT 206994735 UNION ALL
    SELECT 206318371 UNION ALL
    SELECT 206676744 UNION ALL
    SELECT 206291740 UNION ALL
    SELECT 206321537 UNION ALL
    SELECT 206231326 UNION ALL
    SELECT 206355258 UNION ALL
    SELECT 206202413 UNION ALL
    SELECT 206240409 UNION ALL
    SELECT 207032236 UNION ALL
    SELECT 206329775 UNION ALL
    SELECT 206347829 UNION ALL
    SELECT 206310744 UNION ALL
    SELECT 206251779 UNION ALL
    SELECT 206249706 UNION ALL
    SELECT 206691112 UNION ALL
    SELECT 206321390 UNION ALL
    SELECT 206278894 UNION ALL
    SELECT 206337619 UNION ALL
    SELECT 206337128 UNION ALL
    SELECT 206244668 UNION ALL
    SELECT 206226432 UNION ALL
    SELECT 206245381 UNION ALL
    SELECT 206262313 UNION ALL
    SELECT 206319253
),
-- 有效消息（保留时间字段）
valid_msgs AS (
    SELECT
        account_id AS from_user,
        CAST(properties['target_id'] AS BIGINT) AS to_user,
        event_created_time   -- 请确认实际时间字段名，可能为 date_time 或 create_time
    FROM e_immsg
    WHERE (CAST(properties['scene'] AS INT) NOT IN (1,11,14,13,16,4005,12,15) OR properties['scene'] IS NULL)
      AND CAST(properties['im_msg_info']['message_type'] AS INT) IN (6, -1, 0, 2)
      AND account_id != CAST(properties['target_id'] AS BIGINT)
      AND event_created_time >= '2026-05-01'
      AND event_created_time <  '2026-05-08'   -- 包含5.1 ~ 5.7全天
),
-- 关联主播，标记每条消息的主播和用户
msg_anchor_user AS (
    SELECT
        v.from_user,
        v.to_user,
        a.anchor_id,
        CASE WHEN v.from_user = a.anchor_id THEN v.to_user ELSE v.from_user END AS user_id,
        CASE WHEN v.from_user = a.anchor_id THEN 1 ELSE 0 END AS is_anchor_msg,
        v.event_created_time
    FROM valid_msgs v
    JOIN anchor_list a ON v.from_user = a.anchor_id OR v.to_user = a.anchor_id
    WHERE v.from_user != v.to_user
),
-- 按主播-用户对聚合统计，加入时间范围
pair_stats AS (
    SELECT
        anchor_id,
        user_id,
        COUNT(*) AS total_msgs,
        SUM(is_anchor_msg) AS anchor_msgs,
        COUNT(*) - SUM(is_anchor_msg) AS user_msgs,
        MIN(event_created_time) AS first_msg_time,
        MAX(event_created_time) AS last_msg_time
    FROM msg_anchor_user
    GROUP BY anchor_id, user_id
    HAVING total_msgs >= 6               -- 3个回合至少6条消息
       AND anchor_msgs >= 3              -- 主播至少发送3条
       AND user_msgs >= 3                -- 用户至少发送3条
       AND TIMESTAMPDIFF(HOUR, first_msg_time, last_msg_time) <= 24   -- 整个对话在24小时内
)
-- 最终输出每个主播的有效私聊用户数
SELECT
    a.anchor_id,
    COALESCE(p.valid_user_count, 0) AS valid_chat_user_count
FROM anchor_list a
LEFT JOIN (
    SELECT anchor_id, COUNT(DISTINCT user_id) AS valid_user_count
    FROM pair_stats
    GROUP BY anchor_id
) p ON a.anchor_id = p.anchor_id
ORDER BY a.anchor_id;
```

## 主播id & 房间ID & 在麦时长 & 直播总时长

```plaintext
WITH target_anchors AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
      AND account_id IN (
          206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363,
          206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639,
          206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986,
          206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744,
          206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236,
          206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390,
          206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313,
          206319253
      )
),
room_mic AS (
    SELECT 
        account_id,
        CAST(properties['room_id'] AS BIGINT) AS room_id,
        SUM(CAST(properties['duration'] AS INT)) AS mic_duration_seconds
    FROM e_room_vm_record
    WHERE account_id IN (SELECT account_id FROM target_anchors)
       AND event_created_time >= '2026-05-01'
       AND event_created_time < '2026-05-08'
    GROUP BY account_id, room_id
),
-- 房间语音房开播时长（live_mode = '2'）
room_broadcast_duration AS (
    SELECT 
        CAST(properties['room_id'] AS BIGINT) AS room_id,
        SUM(CAST(properties['live_duration'] AS FLOAT)) AS broadcast_duration_seconds
    FROM e_video_room_record
    WHERE CAST(properties['live_mode'] AS CHAR) = '2'
       AND event_created_time >= '2026-05-01'
       AND event_created_time < '2026-05-08'
    GROUP BY room_id
)
SELECT 
    rm.account_id AS 主播ID,
    rm.room_id AS 房间ID,
    rm.mic_duration_seconds AS 在该房间麦位时长_秒,
    COALESCE(rbd.broadcast_duration_seconds, 0) AS 房间语音房开播时长_秒
FROM room_mic rm
LEFT JOIN room_broadcast_duration rbd ON rm.room_id = rbd.room_id
ORDER BY rm.account_id, rm.room_id;
```

## 主播总在麦时长

```plaintext
-- 查询 echo_voko_gp 包中指定主播的在麦位总时长（5.1-5.7）
WITH target_anchors AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
      AND account_id IN (
          206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363, 206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639, 206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986, 206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744, 206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236,
          206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390, 206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313, 206319253
      )
)
SELECT 
    v.account_id AS 主播ID,
    COALESCE(SUM(CAST(v.properties['duration'] AS INT)), 0) AS 总在麦位时长_秒
FROM e_room_vm_record v
JOIN target_anchors a ON v.account_id = a.account_id
WHERE v.event_created_time >= '2026-05-01'
  AND v.event_created_time < '2026-05-08'   -- 包含5.1 ~ 5.7全天
GROUP BY v.account_id
ORDER BY 主播ID;
```

## 主播搭讪 & 接收回复用户数

```plaintext
-- 主动搭讪用户数 + 被回复用户数（每个主播的统计）
WITH target_anchors AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
      AND account_id IN (
          206268175, 211971372, 206248984, 206675971, 206578017, 206304281, 206335363,
          206265585, 206592341, 206676346, 209342510, 207360683, 211526066, 211840639,
          206919982, 206689648, 207021070, 206838094, 206271522, 206575378, 206922986,
          206265115, 206344034, 206631588, 206319075, 206994735, 206318371, 206676744,
          206291740, 206321537, 206231326, 206355258, 206202413, 206240409, 207032236,
          206329775, 206347829, 206310744, 206251779, 206249706, 206691112, 206321390,
          206278894, 206337619, 206337128, 206244668, 206226432, 206245381, 206262313,
          206319253
      )
),
-- 有效私聊消息（过滤场景、类型，时间范围5.1-5.7）
valid_msgs AS (
    SELECT 
        account_id AS from_user,
        CAST(properties['target_id'] AS BIGINT) AS to_user,
        event_created_time
    FROM e_immsg
    WHERE (CAST(properties['scene'] AS INT) NOT IN (1,11,14,13,16,4005,12,15) OR properties['scene'] IS NULL)
      AND CAST(properties['im_msg_info']['message_type'] AS INT) IN (6, -1, 0, 2)
      AND account_id != CAST(properties['target_id'] AS BIGINT)
      AND event_created_time >= '2026-05-01'
      AND event_created_time < '2026-05-08'
),
-- 这些主播主动发出的消息
anchor_send AS (
    SELECT 
        v.from_user AS anchor_id,
        v.to_user AS user_id
    FROM valid_msgs v
    JOIN target_anchors a ON v.from_user = a.account_id
),
-- 这些主播收到的消息（来自其他用户）
anchor_receive AS (
    SELECT 
        v.to_user AS anchor_id,
        v.from_user AS user_id
    FROM valid_msgs v
    JOIN target_anchors a ON v.to_user = a.account_id
),
-- 主动搭讪用户数（每个主播给多少个不同用户发过消息）
initiative AS (
    SELECT 
        anchor_id,
        COUNT(DISTINCT user_id) AS send_user_cnt
    FROM anchor_send
    GROUP BY anchor_id
),
-- 被回复用户数（用户既收到主播消息，也给主播发过消息）
replied AS (
    SELECT 
        s.anchor_id,
        COUNT(DISTINCT s.user_id) AS replied_user_cnt
    FROM anchor_send s
    JOIN anchor_receive r ON s.anchor_id = r.anchor_id AND s.user_id = r.user_id
    GROUP BY s.anchor_id
)
-- 最终输出：所有目标主播（含0值）
SELECT 
    a.account_id AS 主播ID,
    COALESCE(i.send_user_cnt, 0) AS 主动搭讪用户数,
    COALESCE(r.replied_user_cnt, 0) AS 被回复用户数
FROM target_anchors a
LEFT JOIN initiative i ON a.account_id = i.anchor_id
LEFT JOIN replied r ON a.account_id = r.anchor_id
ORDER BY a.account_id;
```

# 整体数据

## 语音房互动率（整体）

```plaintext
WITH 
-- 互动用户：上麦、弹幕、送礼（去重）
interact_users AS (
    SELECT DATE(event_created_time) AS dt, account_id
    FROM prod.e_room_vm_record
    WHERE CAST(properties['live_mode'] AS CHAR) = '2'
      AND event_created_time >= '2026-05-01'
      AND event_created_time < '2026-05-08'
    
    UNION ALL
    
    SELECT DATE(event_created_time) AS dt, account_id
    FROM prod.e_video_room_msg
    WHERE CAST(properties['live_mode'] AS CHAR) = '2'
      AND CAST(properties['group_msg_info']['message_type'] AS INT) = 0
      AND event_created_time >= '2026-05-01'
      AND event_created_time < '2026-05-08'
    
    UNION ALL
    
    SELECT DATE(event_created_time) AS dt, account_id
    FROM prod.e_video_room_user_send_gift
    WHERE CAST(properties['live_mode'] AS CHAR) = '2'
      AND event_created_time >= '2026-05-01'
      AND event_created_time < '2026-05-08'
),
-- 观看用户
view_users AS (
    SELECT DATE(event_created_time) AS dt, account_id
    FROM prod.e_video_room_user_exit
    WHERE CAST(properties['live_mode'] AS CHAR) = '2'
      AND CAST(properties['in_duration'] AS INT) < 86400
      AND event_created_time >= '2026-05-01'
      AND event_created_time < '2026-05-08'
),
-- 渠道筛选
valid_users AS (
    SELECT account_id FROM prod.user
    WHERE properties['channel'] = 'echo_voko_gp'
),
-- 互动用户（限定渠道）
interact_filtered AS (
    SELECT i.dt, i.account_id
    FROM interact_users i
    JOIN valid_users v ON i.account_id = v.account_id
),
-- 观看用户（限定渠道）
view_filtered AS (
    SELECT v.dt, v.account_id
    FROM view_users v
    JOIN valid_users vu ON v.account_id = vu.account_id
),
-- 互动人数聚合（按天）
interact_stats AS (
    SELECT dt, COUNT(DISTINCT account_id) AS interact_cnt
    FROM interact_filtered
    GROUP BY dt
),
-- 观看人数聚合（按天）
view_stats AS (
    SELECT dt, COUNT(DISTINCT account_id) AS view_cnt
    FROM view_filtered
    GROUP BY dt
)
SELECT 
    COALESCE(i.dt, v.dt) AS 日期,
    COALESCE(i.interact_cnt, 0) AS 互动人数,
    COALESCE(v.view_cnt, 0) AS 观看人数,
    CONCAT(CAST(ROUND(COALESCE(i.interact_cnt, 0) * 100.0 / NULLIF(v.view_cnt, 0), 2) AS CHAR), '%') AS 整体互动率
FROM interact_stats i
FULL OUTER JOIN view_stats v ON i.dt = v.dt
ORDER BY 日期;
```

## 区分房间互动率

```plaintext
-- 语音房互动率（echo_voko_gp 渠道，按房间，5.1-5.7汇总）
WITH interactive_users AS (
    -- 上麦用户
    SELECT 
        CAST(r.properties['room_id'] AS BIGINT) AS room_id,
        r.account_id AS uid
    FROM prod.e_room_vm_record r
    JOIN prod.user u ON r.account_id = u.account_id
    WHERE u.properties['channel'] = 'echo_voko_gp'
      AND CAST(r.properties['live_mode'] AS CHAR) = '2'
      AND r.event_created_time >= '2026-05-01'
      AND r.event_created_time < '2026-05-08'
    UNION
    -- 发送弹幕用户
    SELECT 
        CAST(m.properties['room_id'] AS BIGINT) AS room_id,
        m.account_id AS uid
    FROM prod.e_video_room_msg m
    JOIN prod.user u ON m.account_id = u.account_id
    WHERE u.properties['channel'] = 'echo_voko_gp'
      AND CAST(m.properties['group_msg_info']['message_type'] AS INT) = 0
      AND CAST(m.properties['live_mode'] AS CHAR) = '2'
      AND m.event_created_time >= '2026-05-01'
      AND m.event_created_time < '2026-05-08'
    UNION
    -- 送礼用户
    SELECT 
        CAST(g.properties['room_id'] AS BIGINT) AS room_id,
        g.account_id AS uid
    FROM prod.e_video_room_user_send_gift g
    JOIN prod.user u ON g.account_id = u.account_id
    WHERE u.properties['channel'] = 'echo_voko_gp'
      AND CAST(g.properties['live_mode'] AS CHAR) = '2'
      AND g.event_created_time >= '2026-05-01'
      AND g.event_created_time < '2026-05-08'
),
room_interactive AS (
    SELECT 
        room_id,
        COUNT(DISTINCT uid) AS interactive_uv
    FROM interactive_users
    WHERE room_id IS NOT NULL
    GROUP BY room_id
),
room_viewers AS (
    SELECT 
        CAST(v.properties['room_id'] AS BIGINT) AS room_id,
        COUNT(DISTINCT v.account_id) AS view_uv
    FROM prod.e_video_room_user_exit v
    JOIN prod.user u ON v.account_id = u.account_id
    WHERE u.properties['channel'] = 'echo_voko_gp'
      AND CAST(v.properties['live_mode'] AS CHAR) = '2'
      AND v.event_created_time >= '2026-05-01'
      AND v.event_created_time < '2026-05-08'
    GROUP BY CAST(v.properties['room_id'] AS BIGINT)
)
SELECT 
    COALESCE(i.room_id, v.room_id) AS 房间ID,
    COALESCE(i.interactive_uv, 0) AS 互动用户数,
    COALESCE(v.view_uv, 0) AS 观看人数,
    CONCAT(
        CAST(ROUND(COALESCE(i.interactive_uv, 0) * 100.0 / NULLIF(v.view_uv, 0), 2) AS CHAR),
        '%'
    ) AS 互动率
FROM room_interactive i
FULL OUTER JOIN room_viewers v ON i.room_id = v.room_id
ORDER BY 房间ID;
```

## 用户id-充值金额-语音房送礼tokens-接收主播id

> 过滤充值为0的用户

```plaintext
WITH target_users AS (
    SELECT account_id
    FROM prod.user
    WHERE properties['channel'] = 'echo_voko_gp'
),
recharge_data AS (
    SELECT 
        e.account_id,
        SUM(ROUND(CAST(e.properties['amount'] AS INT) / 100.0, 2)) AS recharge_amount
    FROM recharge e
    JOIN target_users u ON e.account_id = u.account_id
    WHERE e.properties['pay_status'] = '1'
      AND e.event_created_time >= '2026-05-13'
      AND e.event_created_time < '2026-05-14'
    GROUP BY e.account_id
    HAVING SUM(ROUND(CAST(e.properties['amount'] AS INT) / 100.0, 2)) > 0
),
gift_detail AS (
    SELECT 
        e.account_id,
        CAST(e.properties['target_id'] AS BIGINT) AS receiver_id,
        SUM(CAST(e.properties['value'] AS FLOAT) * CAST(e.properties['gift_num'] AS FLOAT)) * 10 AS gift_tokens
    FROM prod.e_video_room_user_send_gift e
    JOIN target_users u ON e.account_id = u.account_id
    WHERE CAST(e.properties['live_mode'] AS CHAR) = '2'
      AND e.event_created_time >= '2026-05-13'
      AND e.event_created_time < '2026-05-14'
    GROUP BY e.account_id, receiver_id
)
SELECT 
    r.account_id AS 用户id,
    r.recharge_amount AS 充值金额,
    g.gift_tokens AS 送礼消耗tokens,
    g.receiver_id AS 接收主播id
FROM recharge_data r
JOIN gift_detail g ON r.account_id = g.account_id
ORDER BY 用户id, 接收主播id;
```

## 游戏

```plaintext
WITH game_detail AS (
    -- 展开每个游戏事件中的用户ID数组，得到 (dt, game_id, user_id)
    SELECT 
        DATE(g.event_created_time) AS dt,
        CAST(g.properties['game_id'] AS INT) AS game_id,
        user_id
    FROM prod.e_echo_luk_game_record g
    LATERAL VIEW EXPLODE(CAST(JSON_EXTRACT(properties, '$.user_ids') AS ARRAY<BIGINT>)) t AS user_id
    WHERE CAST(g.properties['game_id'] AS INT) IN (53,54,62,64,71,84,132,161,162)
      AND g.event_created_time >= '2026-05-09'
      AND g.event_created_time < '2026-05-26'
      AND user_id IS NOT NULL
),
game_stats AS (
    SELECT 
        dt,
        game_id,
        COUNT(DISTINCT user_id) AS uv,
        COUNT(*) AS pv,   -- 注意：COUNT(*) 是展开后的行数，等于所有事件中 user_id 的总出现次数（一个事件可能对应多个用户）
        COLLECT_SET(user_id) AS user_list   -- 去重用户ID数组
    FROM game_detail
    GROUP BY dt, game_id
),
daily_active AS (
    -- 全量日活（不限制渠道，可按需调整）
    SELECT 
        DATE(event_created_time) AS dt,
        COUNT(DISTINCT account_id) AS dau
    FROM prod.hour_active
    WHERE event_created_time >= '2026-05-09'
      AND event_created_time < '2026-05-26'
    GROUP BY dt
)
SELECT 
    g.dt AS 日期,
    g.game_id AS 游戏ID,
    g.uv AS 参与人数,
    g.pv AS 参与次数,   -- 参与次数按展开后的用户条目计数（一个事件中每个用户算一次）
    ARRAY_JOIN(g.user_list, ',') AS 用户ID列表,
    COALESCE(d.dau, 0) AS 日活跃人数,
    CONCAT(CAST(ROUND(g.uv * 100.0 / NULLIF(d.dau, 0), 2) AS CHAR), '%') AS 使用率
FROM game_stats g
LEFT JOIN daily_active d ON g.dt = d.dt
ORDER BY g.dt, g.game_id;
```

## 匹配

```plaintext
WITH echo_users AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
),
all_matches AS (
    SELECT 
        account_id,
        event_created_time,
        CAST(properties['enqueue_time_ms'] AS BIGINT) AS enqueue_ms,
        CAST(properties['matched_time_ms'] AS BIGINT) AS matched_ms,
        CAST(properties['match_duration_ms'] AS BIGINT) AS match_duration_ms,
        CAST(properties['call_end_time_ms'] AS BIGINT) AS call_end_ms,
        CAST(properties['status'] AS INT) AS status,
        CAST(properties['call_duration_seconds'] AS DOUBLE) AS call_duration_sec
    FROM e_echo_match_record
    WHERE event_created_time >= '2026-05-29' AND event_created_time < '2026-06-12'
    UNION ALL
    SELECT 
        account_id,
        event_created_time,
        CAST(properties['enqueue_time_ms'] AS BIGINT),
        CAST(properties['matched_time_ms'] AS BIGINT),
        CAST(properties['match_duration_ms'] AS BIGINT),
        CAST(properties['call_end_time_ms'] AS BIGINT),
        CAST(properties['status'] AS INT),
        CAST(properties['call_duration_seconds'] AS DOUBLE)
    FROM e_echo_match_record_temp
    WHERE event_created_time >= '2026-05-29' AND event_created_time < '2026-06-12'
),
valid AS (
    SELECT m.*
    FROM all_matches m
    JOIN echo_users u ON m.account_id = u.account_id
),
initiate AS (
    SELECT 
        DATE(event_created_time) AS dt,
        COUNT(DISTINCT account_id) AS initiate_uv,
        COUNT(*) AS initiate_pv_raw
    FROM valid
    GROUP BY dt
),
success_events AS (
    SELECT 
        DATE(event_created_time) AS dt,
        account_id,
        match_duration_ms / 1000.0 AS wait_sec,
        call_duration_sec
    FROM valid
    WHERE status = 3 
      AND match_duration_ms IS NOT NULL
      AND (match_duration_ms / 1000.0) < 600
),
success_stats_base AS (
    SELECT 
        dt,
        COUNT(DISTINCT account_id) AS success_uv,
        COUNT(*) AS success_pv_raw,
        AVG(wait_sec) AS success_avg_wait
    FROM success_events
    GROUP BY dt
),
valid_call_events AS (
    SELECT 
        dt,
        call_duration_sec
    FROM success_events
    WHERE call_duration_sec IS NOT NULL 
      AND call_duration_sec < 600
),
call_stats AS (
    SELECT 
        dt,
        AVG(call_duration_sec) AS avg_call_per_success,
        COUNT(CASE WHEN call_duration_sec >= 0 AND call_duration_sec < 5 THEN 1 END) AS call_0_5,
        COUNT(CASE WHEN call_duration_sec >= 5 AND call_duration_sec < 10 THEN 1 END) AS call_5_10,
        COUNT(CASE WHEN call_duration_sec >= 10 AND call_duration_sec < 15 THEN 1 END) AS call_10_15,
        COUNT(CASE WHEN call_duration_sec >= 15 AND call_duration_sec < 20 THEN 1 END) AS call_15_20,
        COUNT(CASE WHEN call_duration_sec >= 20 AND call_duration_sec < 30 THEN 1 END) AS call_20_30,
        COUNT(CASE WHEN call_duration_sec >= 30 AND call_duration_sec < 60 THEN 1 END) AS call_30_60,
        COUNT(CASE WHEN call_duration_sec >= 60 AND call_duration_sec < 600 THEN 1 END) AS call_60_plus
    FROM valid_call_events
    GROUP BY dt
),
daily_active AS (
    SELECT 
        DATE(h.event_created_time) AS dt,
        COUNT(DISTINCT h.account_id) AS dau
    FROM hour_active h
    JOIN echo_users u ON h.account_id = u.account_id
    WHERE h.event_created_time >= '2026-05-29' AND h.event_created_time < '2026-06-12'
    GROUP BY dt
)
SELECT 
    COALESCE(i.dt, s.dt, c.dt, d.dt) AS 日期,
    COALESCE(i.initiate_uv, 0) AS 匹配参与人数,
    COALESCE(i.initiate_pv_raw, 0) / 2 AS 匹配发起次数,
    COALESCE(s.success_uv, 0) AS 匹配成功人数,
    COALESCE(s.success_pv_raw, 0) / 2 AS 匹配成功次数,
    CONCAT(CAST(ROUND(COALESCE(i.initiate_uv, 0) * 100.0 / NULLIF(d.dau, 0), 2) AS CHAR), '%') AS 匹配使用率,
    ROUND(COALESCE(s.success_avg_wait, 0), 2) AS 匹配成功平均等待时长_秒,
    ROUND(COALESCE(c.avg_call_per_success, 0), 2) AS 平均匹配通话时长_秒,
    COALESCE(c.call_0_5, 0) AS 通话0_5秒次数,
    COALESCE(c.call_5_10, 0) AS 通话5_10秒次数,
    COALESCE(c.call_10_15, 0) AS 通话10_15秒次数,
    COALESCE(c.call_15_20, 0) AS 通话15_20秒次数,
    COALESCE(c.call_20_30, 0) AS 通话20_30秒次数,
    COALESCE(c.call_30_60, 0) AS 通话30_60秒次数,
    COALESCE(c.call_60_plus, 0) AS 通话60秒以上次数
FROM initiate i
FULL OUTER JOIN success_stats_base s ON i.dt = s.dt
FULL OUTER JOIN call_stats c ON COALESCE(i.dt, s.dt) = c.dt
FULL OUTER JOIN daily_active d ON COALESCE(i.dt, s.dt, c.dt) = d.dt
ORDER BY 日期;
```

## 主播ID-在麦时长-游戏房直播时长-语音房直播时长-总时长-有效天数-Credits收入-匹配成功次数-游戏参与次数

> 匹配60s以上的

```plaintext
WITH anchor_list AS (
    SELECT account_id
    FROM user
    WHERE properties['channel'] = 'echo_voko_gp'
      AND account_id IN (
          206202413,206240409,206249706,206265585,206318371,206321390,206355258,206689648,206691112,219688273,228535763,229504564,229557672,242686460,242747781,242750210,242751659,242759854,242760425,242764868,242765150,242765636,242773159,242773346,242775933,242776245,242778720,242778863,242782337,242782947,242785474,242788110,242788422,242788774,242792636,242804659,242804665,242808824,242811553,242820144,242822376,242822953,242835878,242887298,242889769,242893164,242897955,242902295,242905528,242911316,242912194,242914259,242983074,243014686,243380463
      )
),
a AS (
    SELECT
        account_id,
        SUM(CAST(properties['duration'] AS INT)) / 3600.0 AS 在麦时长_小时
    FROM e_room_vm_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-09'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
b AS (
    SELECT
        account_id,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS 总直播时长_小时,
        SUM(CAST(properties['game_duration'] AS INT)) / 3600.0 AS 游戏房直播时长_小时
    FROM e_video_room_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-09'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
c AS (
    SELECT
        account_id,
        SUM(CAST(properties['prop_change_real'] AS FLOAT)) * 10 AS echo_credit收入
    FROM prop
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-09'
      AND account_id IN (SELECT account_id FROM anchor_list)
      AND properties['prop_name_new'] = 'Credits'
      AND CAST(properties['prop_change_real'] AS FLOAT) > 0
    GROUP BY account_id
),
daily_live_duration AS (
    SELECT
        account_id,
        DATE(event_created_time) AS dt,
        SUM(CAST(properties['live_duration'] AS INT)) / 3600.0 AS daily_live_hours
    FROM e_video_room_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-09'
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id, DATE(event_created_time)
),
valid_days AS (
    SELECT account_id, COUNT(DISTINCT dt) AS 有效天数
    FROM daily_live_duration
    WHERE daily_live_hours >= 2
    GROUP BY account_id
),
match_success AS (
    SELECT account_id, COUNT(*) AS 匹配成功次数
    FROM e_echo_match_record
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-09'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
    UNION ALL
    SELECT account_id, COUNT(*)
    FROM e_echo_match_record_temp
    WHERE event_created_time >= '2026-06-01' AND event_created_time < '2026-06-09'
      AND CAST(properties['status'] AS INT) = 3
      AND CAST(properties['call_duration_seconds'] AS DOUBLE) >= 60
      AND account_id IN (SELECT account_id FROM anchor_list)
    GROUP BY account_id
),
match_total AS (
    SELECT account_id, SUM(匹配成功次数) AS 匹配成功次数
    FROM match_success
    GROUP BY account_id
),
game_participants AS (
    SELECT
        g.account_id,
        user_id
    FROM e_echo_luk_game_record g
    LATERAL VIEW EXPLODE(CAST(JSON_EXTRACT(properties, '$.user_ids') AS ARRAY<BIGINT>)) t AS user_id
    WHERE g.event_created_time >= '2026-06-01' AND g.event_created_time < '2026-06-09'
      AND user_id IN (SELECT account_id FROM anchor_list)
),
game_play_count AS (
    SELECT
        user_id AS account_id,
        COUNT(*) AS 游戏参与次数
    FROM game_participants
    GROUP BY user_id
)
SELECT
    al.account_id AS 主播ID,
    COALESCE(a.在麦时长_小时, 0) AS 在麦时长_小时,
    COALESCE(b.游戏房直播时长_小时, 0) AS 游戏房直播时长_小时,
    COALESCE(b.总直播时长_小时, 0) - COALESCE(b.游戏房直播时长_小时, 0) AS 语音房直播时长_小时,
    COALESCE(a.在麦时长_小时, 0) + COALESCE(b.总直播时长_小时, 0) AS 总时长_小时,
    COALESCE(vd.有效天数, 0) AS 有效天数,
    COALESCE(c.echo_credit收入, 0) AS Credits收入,
    COALESCE(mt.匹配成功次数, 0) AS 匹配成功次数,
    COALESCE(gp.游戏参与次数, 0) AS 游戏参与次数
FROM anchor_list al
LEFT JOIN a ON al.account_id = a.account_id
LEFT JOIN b ON al.account_id = b.account_id
LEFT JOIN c ON al.account_id = c.account_id
LEFT JOIN valid_days vd ON al.account_id = vd.account_id
LEFT JOIN match_total mt ON al.account_id = mt.account_id
LEFT JOIN game_play_count gp ON al.account_id = gp.account_id
ORDER BY 总时长_小时 DESC;
```