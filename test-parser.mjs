import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Dynamic import of the compiled modules
  // We need to use tsx or ts-node to run this
  
  const filePath = path.join(__dirname, "data", "2026-2027 - Planification des cours Brest.ods");
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  
  console.log(`File size: ${buffer.length} bytes`);
  
  // We'll use dynamic import for the TS modules
  try {
    const { parseOdsFile } = await import("./src/lib/ods-parser");
    
    console.log("Parsing with option CSN...");
    const result = await parseOdsFile(arrayBuffer, "CSN");
    
    console.log(`Events: ${result.events.length}`);
    console.log(`Warnings: ${result.warnings.length}`);
    console.log(`Grid: ${result.grid.length} rows`);
    
    if (result.events.length > 0) {
      console.log("First 3 events:", JSON.stringify(result.events.slice(0, 3), null, 2));
    }
    
    if (result.warnings.length > 0) {
      console.log("First 5 warnings:", JSON.stringify(result.warnings.slice(0, 5), null, 2));
    }
  } catch (err) {
    console.error("Parse error:", err);
  }
}

main();
