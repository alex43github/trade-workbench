#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (!value.startsWith("--")) continue;
  args.set(value, process.argv[i + 1]);
  i += 1;
}

const sourceJson = args.get("--source-json");
const sourceCommit = args.get("--source-commit");
const output = args.get("--output") ?? "docs/hypergrid/knowledge/cj/source-index.json";
const topicIndexPath = args.get("--topic-index") ?? "docs/hypergrid/knowledge/cj/topic-index.json";

if (!sourceJson || !sourceCommit) {
  throw new Error("Usage: node scripts/hypergrid-cj-build-index.mjs --source-json <path> --source-commit <sha> [--topic-index <path>] [--output <path>]");
}

const raw = JSON.parse(fs.readFileSync(sourceJson, "utf8"));
const topicIndex = JSON.parse(fs.readFileSync(topicIndexPath, "utf8"));
if (!Array.isArray(raw) || !Array.isArray(topicIndex.topics)) {
  throw new Error("Expected source JSON array and topic-index.json topics array");
}

const topicIdsBySource = new Map();
for (const topic of topicIndex.topics) {
  for (const sourceId of topic.source_ids) {
    const existing = topicIdsBySource.get(String(sourceId)) ?? [];
    existing.push(topic.topic_id);
    topicIdsBySource.set(String(sourceId), existing);
  }
}

const seen = new Set();
const posts = raw.map((item) => {
  const sourceId = String(item.id);
  if (seen.has(sourceId)) throw new Error(`Duplicate source ID: ${sourceId}`);
  seen.add(sourceId);
  if (!item.url || !item.date) throw new Error(`Missing URL/date for source ID: ${sourceId}`);
  const timestamp = new Date(item.date);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`Invalid date for source ID: ${sourceId}`);
  return {
    source_id: sourceId,
    date_raw: item.date,
    date_utc: timestamp.toISOString(),
    title: null,
    title_note: "The public JSON/CSV dataset exposes no per-post title.",
    topic_tags: [...(item.tags ?? [])],
    handbook_topic_ids: [...new Set(topicIdsBySource.get(sourceId) ?? [])],
    url: item.url,
    source_files: ["cj/data/cj_arbitrage_lp_tweets.json", "cj/data/cj_arbitrage_lp_tweets.csv"],
    media_count: item.media_count ?? 0
  };
});

const result = {
  schema_version: 1,
  source_repository: "https://github.com/suoha888/Trader-Archives",
  source_commit: sourceCommit,
  source_data_file: "cj/data/cj_arbitrage_lp_tweets.json",
  discovered_posts: posts.length,
  processed_posts: posts.length,
  unique_source_ids: seen.size,
  posts
};

const outputPath = path.resolve(output);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, discovered_posts: posts.length, processed_posts: posts.length, unique_source_ids: seen.size, handbook_topic_links: posts.filter((post) => post.handbook_topic_ids.length > 0).length }));
