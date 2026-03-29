const fs = require('fs');

try {
  const content = fs.readFileSync('./reports/results.xml', 'utf8');
  // Log content to verify
  console.log('--- XML CONTENT ---');
  console.log(content.substring(0, 500));
  
  const testsuiteMatches = [...content.matchAll(/<testsuite[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"[^>]*skipped="(\d+)"/g)];
  
  console.log('--- MATCHES ---');
  console.log(testsuiteMatches.length);
  
  if (testsuiteMatches.length === 0) {
    console.log('No matches found.');
  } else {
    for (const match of testsuiteMatches) {
        console.log(match);
    }
  }
} catch (err) {
  console.error(err);
}
