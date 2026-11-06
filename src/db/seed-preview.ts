import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { getEnv } from '../config/env.js';
import { makePreviewTraffic } from './preview-traffic.js';

const env = getEnv();
if (!env.DEV_PREVIEW || process.env.NODE_ENV !== 'development' || new URL(env.PUBLIC_BASE_URL).hostname !== 'localhost') {
  throw new Error('Preview seed requires DEV_PREVIEW=true, NODE_ENV=development and a localhost PUBLIC_BASE_URL');
}
try {
  await pool.query(
    `INSERT INTO installations(location_id,company_id,access_token,refresh_token,expires_at,site_key,allowed_origins)
     VALUES('local-preview','local-preview','','',now() + interval '1 year',$1,ARRAY[$2])
     ON CONFLICT(location_id) DO NOTHING`,
    [randomBytes(24).toString('hex'), new URL(env.PUBLIC_BASE_URL).origin]
  );
  await pool.query(
    `INSERT INTO journeys(id,location_id,name,slug,status,priority,rules,content,add_tags)
     VALUES($1,'local-preview','Spring campaign','spring-campaign','published',10,
       '{"utmSource":"","utmCampaign":"spring","pathContains":"","referrerContains":"","requiredTag":""}',
       '{"headline":"A journey shaped around you","description":"This page responds to your campaign intent.","ctaText":"Explore Xaylo","ctaUrl":"https://xaylo.com/","agentContext":"Visitor arrived from the spring campaign.","emailAngle":"Follow up on their interest in personalised journeys."}',
       ARRAY['xaylo:spring']) ON CONFLICT(location_id,slug) DO NOTHING`, [randomUUID()]
  );
  const events = makePreviewTraffic();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Replace only marked sample traffic, including steps removed from revised paths.
    await client.query("DELETE FROM events WHERE location_id='local-preview' AND properties->>'previewSeed'='traffic-v1'");
    await client.query(
    `INSERT INTO events(id,location_id,visitor_id,session_id,event_type,page_url,properties,created_at)
     SELECT item.id::uuid,'local-preview',item.visitor_id,item.session_id::uuid,
            item.event_type,item.page_url,item.properties,item.created_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS item(
       id text, visitor_id text, session_id text, event_type text,
       page_url text, properties jsonb, created_at text)
     ON CONFLICT(id) DO UPDATE SET visitor_id=excluded.visitor_id, session_id=excluded.session_id,
       event_type=excluded.event_type, page_url=excluded.page_url,
       created_at=excluded.created_at, properties=excluded.properties`,
    [JSON.stringify(events)]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  console.log(`Local preview seeded: 1,000 visitor sessions, ${events.length} events`);
} finally { await pool.end(); }
