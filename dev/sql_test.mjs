// Applies tools/sql/v5.sql to simulated v4 table shapes in PGlite (Postgres in WASM, dev only) and checks it.
// Run: (cd <scratch dir> && npm i @electric-sql/pglite@0.2.17) && PGLITE_DIR=<scratch dir> node dev/sql_test.mjs
import { createRequire } from 'module'; import path from 'path';
const req = createRequire(path.join(process.env.PGLITE_DIR || process.cwd(), 'x.js'));
const { PGlite } = await import(req.resolve('@electric-sql/pglite'));
import fs from 'fs';
const MIG = fs.readFileSync(new URL('../tools/sql/v5.sql', import.meta.url), 'utf8');
const variants = {
  'in-list + octet_length, at timestamptz': `create table public.lumiar_mundo (w text not null, c text not null, id text not null, d jsonb, at timestamptz not null default now(), primary key (w,c,id),
     constraint lumiar_mundo_c_check check (c in ('builds4','cut4','tames4','disc4','chest4')),
     constraint lumiar_mundo_d_check check (d is null or octet_length(d::text) < 16000));`,
  'any(array) + pg_column_size, unnamed, at text': `create table public.lumiar_mundo (w text not null, c text not null check (c = any (array['builds4','cut4','tames4','disc4','chest4','builds3'])), id text not null, d jsonb check (pg_column_size(d) < 8000), at text, primary key (w,c,id));`,
  'no checks at all': `create table public.lumiar_mundo (w text, c text, id text, d jsonb, at timestamptz default now(), primary key (w,c,id)); insert into lumiar_mundo values ('m','legacy','z','{}',now());`,
};
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('   FAIL', m); } };
for (const [name, ddl] of Object.entries(variants)) {
  const db = new PGlite(); await db.exec(`create role anon; create role authenticated;`); await db.exec(ddl);
  await db.exec(`insert into lumiar_mundo (w,c,id,d,at) values ('m','builds4','b1','{"x":1}', now())`);
  if (name.includes('builds3')) await db.exec(`insert into lumiar_mundo (w,c,id,d,at) values ('m','builds3','old','{"x":1}', now())`);
  await db.exec(MIG); await db.exec(MIG); // idempotent
  const cons = (await db.query(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.lumiar_mundo'::regclass and contype='c'`)).rows;
  console.log('== ' + name); for (const c of cons) console.log('   ', c.conname, c.d.slice(0, 140));
  const tryq = async (sql) => { try { await db.exec(sql); return true; } catch (e) { return e.message; } };
  ok(await tryq(`insert into lumiar_mundo (w,c,id,d,at) values ('m','p5','vini','{"t":100,"inv":{}}', now())`) === true, 'p5 insert');
  for (const c of ['m5','b5','h5','t5','f5','k5','w5','d5']) ok(await tryq(`insert into lumiar_mundo (w,c,id,d,at) values ('m','${c}','x','{"t":1}', now())`) === true, c + ' insert');
  ok(await tryq(`insert into lumiar_mundo (w,c,id,d,at) values ('m','builds4','b2','{"x":2}', now())`) === true, 'v4 still ok');
  if (name.includes('builds3')) ok(await tryq(`insert into lumiar_mundo (w,c,id,d) values ('m','builds3','b9','{}')`) === true, 'old names kept');
  if (!name.includes('no checks')) ok(typeof await tryq(`insert into lumiar_mundo (w,c,id,d,at) values ('m','zz9','x','{}', now())`) === 'string', 'unknown collection refused');
  const big = JSON.stringify({ s: 'x'.repeat(31000), t: 1 });
  ok(await tryq(`insert into lumiar_mundo (w,c,id,d,at) values ('m','k5','big','${big}', now())`) === true, '31 KB row ok');
  ok(typeof await tryq(`insert into lumiar_mundo (w,c,id,d,at) values ('m','k5','big2','${JSON.stringify({ s: 'x'.repeat(33000) })}', now())`) === 'string', '33 KB refused');
  // newer wins (upsert as PostgREST does it)
  const up = (id, d, at) => db.query(`insert into lumiar_mundo (w,c,id,d,at) values ('m','b5',$1,$2::jsonb,$3) on conflict (w,c,id) do update set d=excluded.d, at=excluded.at`, [id, d, at]);
  await up('door', '{"t":2000,"o":true}', new Date(2000).toISOString());
  await up('door', '{"t":1000,"o":false}', new Date(1000).toISOString()); // older: ignored
  let r = (await db.query(`select d from lumiar_mundo where c='b5' and id='door'`)).rows[0].d; ok(r.t === 2000 && r.o === true, 'older update ignored');
  await up('door', '{"t":3000,"o":false}', new Date(3000).toISOString()); r = (await db.query(`select d from lumiar_mundo where c='b5' and id='door'`)).rows[0].d; ok(r.t === 3000, 'newer update applied');
  await up('door', null, new Date(2500).toISOString()); r = (await db.query(`select d from lumiar_mundo where c='b5' and id='door'`)).rows[0].d; ok(r && r.t === 3000, 'older delete ignored');
  await up('door', null, new Date(4000).toISOString()); r = (await db.query(`select d from lumiar_mundo where c='b5' and id='door'`)).rows[0].d; ok(r === null, 'newer delete applied');
  await up('door', '{"t":3500}', new Date(3500).toISOString()); r = (await db.query(`select d from lumiar_mundo where c='b5' and id='door'`)).rows[0].d; ok(r === null, 'older than tombstone ignored');
  // v4 rows: last writer wins as before
  await db.query(`insert into lumiar_mundo (w,c,id,d,at) values ('m','builds4','b1','{"x":9}', $1) on conflict (w,c,id) do update set d=excluded.d, at=excluded.at`, [new Date(1).toISOString()]);
  r = (await db.query(`select d from lumiar_mundo where c='builds4' and id='b1'`)).rows[0].d; ok(r.x === 9, 'v4 untouched behaviour');
  const now = (await db.query(`select public.lumiar_now() n`)).rows[0].n; ok(now instanceof Date || typeof now === 'string', 'lumiar_now');
  await db.close();
}
console.log(fails ? fails + ' FAILED' : 'SQL migration: all checks passed');
