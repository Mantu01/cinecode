import { createScaffoldCommand } from "./scaffold.js";

const scaffoldCmd = createScaffoldCommand();
scaffoldCmd.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
