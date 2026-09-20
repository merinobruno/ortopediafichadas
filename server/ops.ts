import {
  snapshotDatabase,
  restoreDatabase,
  verifyDatabase,
  acknowledgeRecovery,
} from "./backup";
const [command, source, destination, ...extra] = process.argv.slice(2);
try {
  if (!source || extra.length) throw new Error("Invalid arguments");
  if (command === "backup" && destination)
    await snapshotDatabase(source, destination);
  else if (command === "restore" && destination)
    await restoreDatabase(source, destination);
  else if (command === "verify" && !destination) verifyDatabase(source);
  else if (command === "acknowledge-recovery" && !destination)
    acknowledgeRecovery(source);
  else throw new Error("Invalid command");
  console.log("Operation completed");
} catch {
  console.error(
    "Operation failed. Check command, paths and database integrity. Existing files were not overwritten.",
  );
  process.exitCode = 1;
}
