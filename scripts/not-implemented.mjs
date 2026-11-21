const [script = 'this script', owner = 'a later worker'] = process.argv.slice(2);
console.error(`npm run ${script}: not implemented yet (owned by ${owner}; see AGENTS.md).`);
process.exit(1);
