const fs = require('fs');

try {
  const content = fs.readFileSync('./reports/results.xml', 'utf8');
  
  // Try regex that doesn't rely on strict order of attributes
  const testsuiteMatches = [...content.matchAll(/<testsuite[^>]+tests="(\d+)"[^>]+failures="(\d+)"[^>]+errors="(\d+)"[^>]+skipped="(\d+)"/g)];
  
  console.log('--- MATCHES ---');
  console.log(testsuiteMatches.length);
  
  if (testsuiteMatches.length === 0) {
    console.log('No matches found.');
    // Check if attributes exist at all
    const attrTest = content.match(/tests="(\d+)"/);
    console.log('Tests attribute found?', attrTest);
  } else {
    for (const match of testsuiteMatches) {
        console.log(match);
    }
  }
} catch (err) {
  console.error(err);
}
