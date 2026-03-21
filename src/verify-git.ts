import { GitService } from "./core/git.js";

async function verify() {
  const git = new GitService(process.cwd());

  console.log("🔍 Testing isGitRepo...");
  const isRepo = await git.isGitRepo();
  console.log(`✅ isGitRepo: ${isRepo}`);

  console.log("🔍 Testing getCurrentSha...");
  const sha = await git.getCurrentSha();
  console.log(`✅ Current SHA: ${sha}`);

  console.log("🔍 Testing getWorkingChanges...");
  const changes = await git.getWorkingChanges();
  console.log("✅ Working changes detected:", changes.all.length);

  console.log("🔍 Testing getChangedFilesSinceSha (full index)...");
  const allFiles = await git.getChangedFilesSinceSha("");
  console.log("✅ All tracked files:", allFiles.length);

  console.log("🎉 Git Utilities Verification Complete!");
}

verify().catch(err => {
  console.error("❌ Verification failed:", err.message);
  process.exit(1);
});
