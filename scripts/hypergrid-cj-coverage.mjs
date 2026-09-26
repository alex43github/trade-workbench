#!/usr/bin/env node

import fs from "node:fs";

const root = process.cwd();
const kb = `${root}/docs/hypergrid/knowledge/cj`;
const source = JSON.parse(fs.readFileSync(`${kb}/source-index.json`, "utf8"));
const topics = JSON.parse(fs.readFileSync(`${kb}/topic-index.json`, "utf8"));

const expectedPosts = Number(process.argv[2] ?? 502);
const expectedTopics = Number(process.argv[3] ?? 28);
const ids = source.posts.map((post) => post.source_id);
const urls = source.posts.map((post) => post.url);
const topicIds = topics.topics.map((topic) => topic.topic_id);
const allTopicSourceIds = topics.topics.flatMap((topic) => topic.source_ids.map(String));
const sourceIdSet = new Set(ids);
const topicIdSet = new Set(topicIds);

const requiredClaimsHeaders = [
  "claim_id",
  "topic",
  "normalized_claim",
  "evidence_class",
  "source_ids",
  "source_urls",
  "independent_verification",
  "confidence",
  "engineering_destination",
  "backtest_required",
  "notes"
];

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  fields.push(field);
  return fields;
}

const csv = fs.readFileSync(`${kb}/12_CLAIMS_EVIDENCE_MATRIX.csv`, "utf8").replace(/^\uFEFF/, "");
const csvLines = csv.split(/\r?\n/).filter((line) => line.length > 0);
const header = parseCsvLine(csvLines[0]);
const claims = csvLines.slice(1).map(parseCsvLine);
const headerPass = requiredClaimsHeaders.every((name, index) => header[index] === name);
const rowWidthPass = claims.every((row) => row.length === header.length);

const checks = {
  corpus_coverage: source.discovered_posts === expectedPosts && source.processed_posts === expectedPosts && source.posts.length === expectedPosts,
  source_id_integrity: sourceIdSet.size === ids.length && ids.every((id) => /^\d+$/.test(id)),
  source_url_integrity: new Set(urls).size === urls.length && urls.every((url) => /^https:\/\//.test(url)),
  topic_coverage: topics.discovered_topics === expectedTopics && topics.topics.length === expectedTopics,
  topic_id_integrity: topicIdSet.size === topicIds.length && topicIds.every((id) => /^t-\d{2}$/.test(id)),
  topic_source_integrity: allTopicSourceIds.every((id) => sourceIdSet.has(id)),
  claims_csv: headerPass && rowWidthPass && claims.length > 0
};

for (const [name, pass] of Object.entries(checks)) {
  console.log(`${name.toUpperCase()}=${pass ? "PASS" : "FAIL"}`);
}
console.log(`DISCOVERED_POSTS=${source.discovered_posts}`);
console.log(`PROCESSED_POSTS=${source.processed_posts}`);
console.log(`DISCOVERED_TOPICS=${topics.discovered_topics}`);
console.log(`PROCESSED_TOPICS=${topics.topics.length}`);
console.log(`COVERAGE_POSTS=${((source.processed_posts / source.discovered_posts) * 100).toFixed(2)}%`);
console.log(`COVERAGE_TOPICS=${((topics.topics.length / topics.discovered_topics) * 100).toFixed(2)}%`);
console.log(`CLAIMS_MATRIX_ROWS=${claims.length}`);

if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
