import type { IFileEntry, ISuggestionResult } from "./types.js";
import { DescriptorStore } from "./store/descriptor.js";
import { Matcher } from "./core/matcher.js";
import { OllamaService } from "./llm/ollama.js";
import { PromptLoader } from "./llm/prompts.js";

async function verify() {
  console.log("🔍 Testing Matcher (Phase 1 — keyword funnel, no LLM needed)...\n");

  // Set up a mock store with data
  const store = new DescriptorStore(process.cwd());
  await store.load();

  // Simulate indexed files
  const sourceFile: IFileEntry = {
    name: "src/services/authService.ts",
    description: "Handles user authentication via JWT tokens",
    keywords: ["authentication", "jwt", "login", "logout", "token", "session", "user", "service"],
    components: ["AuthService", "validateToken", "refreshToken"],
    type: "source",
  };

  const testDirect: IFileEntry = {
    name: "src/__tests__/authService.test.ts",
    description: "Unit tests for AuthService",
    keywords: ["authentication", "jwt", "login", "token", "test", "mock"],
    components: ["AuthService", "validateToken"],
    type: "test",
  };

  const testRelated: IFileEntry = {
    name: "cypress/e2e/login.cy.ts",
    description: "E2E test for login flow",
    keywords: ["login", "authentication", "e2e", "cypress", "user"],
    components: ["LoginPage"],
    type: "test",
  };

  const testUnrelated: IFileEntry = {
    name: "src/__tests__/payment.test.ts",
    description: "Payment processing tests",
    keywords: ["payment", "stripe", "checkout", "billing"],
    components: ["PaymentService"],
    type: "test",
  };

  // Upsert into store
  store.upsertFileEntry(sourceFile);
  store.upsertFileEntry(testDirect);
  store.upsertFileEntry(testRelated);
  store.upsertFileEntry(testUnrelated);

  // Create matcher (Ollama will fail since not running, but Phase 1 works standalone)
  const ollama = new OllamaService("http://localhost:11434", "qwen2.5-coder:3b");
  const promptLoader = new PromptLoader();
  const matcher = new Matcher(store, ollama, promptLoader);

  // Phase 1 test
  const candidates = matcher.keywordMatch([sourceFile]);

  console.log(`Found ${candidates.length} candidates:`);
  for (const c of candidates) {
    console.log(`  ${c.testFile.name} → score: ${c.score.toFixed(3)}, keywords: [${c.matchedKeywords.join(", ")}]`);
  }

  // Verify direct test scores highest
  if (candidates.length >= 2) {
    console.log("\n✅ Multiple candidates returned");
  } else {
    console.error("❌ Expected at least 2 candidates");
    process.exit(1);
  }

  if (candidates[0].testFile.name === testDirect.name) {
    console.log("✅ Direct test has highest score");
  } else {
    console.error("❌ Direct test should be ranked first");
    process.exit(1);
  }

  if (candidates[0].score > candidates[1].score) {
    console.log("✅ Score ordering is correct");
  } else {
    console.error("❌ Score ordering is wrong");
    process.exit(1);
  }

  // Verify unrelated test is not present (or very low)
  const paymentCandidate = candidates.find(c => c.testFile.name === testUnrelated.name);
  if (!paymentCandidate || paymentCandidate.score < 0.1) {
    console.log("✅ Unrelated test excluded or very low score");
  } else {
    console.error("❌ Unrelated test should have low/zero score");
    process.exit(1);
  }

  console.log("\n🎉 Core Logic (Matcher Phase 1) Verification Complete!");
}

verify().catch(err => {
  console.error("❌ Verification failed:", err.message);
  process.exit(1);
});
