import { buildDemoDashboard, demoAccounts, demoConsultation, demoReviews } from "./demo.ts";

export async function getDashboardSnapshot() { return buildDemoDashboard(); }
export async function listConsultations() { return { mode: "demo" as const, updatedAt: demoConsultation.updatedAt, realOrderRouteEnabled: false, consultations: [demoConsultation] }; }
export async function getArenaSnapshot() { return { mode: "demo" as const, updatedAt: demoConsultation.updatedAt, realOrderRouteEnabled: false, season: { name: "MVP 演示赛季", status: "DEMO", fundingRule: "500 USDT · 最高10x · 不续资" }, accounts: demoAccounts }; }
export async function listReviews() { return { mode: "demo" as const, updatedAt: demoConsultation.updatedAt, realOrderRouteEnabled: false, reviews: demoReviews }; }

