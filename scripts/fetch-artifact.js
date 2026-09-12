// Haalt de echt gerenderde inhoud van een Claude Artifact op.
//
// Waarom dit niet met een simpele curl kan: de pagina op
// claude.ai/code/artifact/... is zelf maar een lege "shell" die via
// JavaScript een <iframe> opent naar een apart subdomein
// (*.frame.claudeusercontent.com) -- pas dat iframe bevat de echte
// catalogus-HTML. curl voert geen JavaScript uit en ziet dus nooit de
// echte inhoud, ongeacht de share-instellingen. Dit script gebruikt
// daarom een echte (headless) browser via Playwright, wacht tot het
// iframe geladen is, en haalt dan specifiek de inhoud van dat iframe op.
//
// Let op: dit is geen garantie. claude.ai gebruikt Cloudflare
// bot-detectie; het is mogelijk dat verzoeken vanaf GitHub Actions
// IP-adressen daardoor alsnog geblokkeerd worden. Als dat gebeurt, faalt
// deze stap en verschijnt er geen nieuwe commit -- dat is dan geen bug in
// dit script maar een limiet die niet oplosbaar is vanuit een CI-omgeving.

const { chromium } = require("playwright");
const fs = require("fs");

const ARTIFACT_URL = process.env.ARTIFACT_URL;

async function main() {
  if (!ARTIFACT_URL) {
    console.error("ARTIFACT_URL ontbreekt.");
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  try {
    await page.goto(ARTIFACT_URL, { waitUntil: "networkidle", timeout: 60000 });
  } catch (e) {
    console.error("Kon de artifact-pagina niet laden:", e.message);
    await browser.close();
    process.exit(1);
  }

  // Geef het iframe wat extra tijd om zijn eigen inhoud te laden.
  await page.waitForTimeout(4000);

  let content = null;
  for (const frame of page.frames()) {
    if (frame.url().includes("frame.claudeusercontent.com")) {
      try {
        const c = await frame.content();
        if (c.includes("TOOL_DATA")) {
          content = c;
          break;
        }
      } catch (e) {
        // Frame kan intussen weg zijn (hot-swap); probeer de volgende.
      }
    }
  }

  await browser.close();

  if (!content) {
    console.error(
      "Geen frame gevonden met TOOL_DATA erin -- de artifact kon niet " +
        "gerenderd worden (mogelijk bot-detectie, of de pagina-structuur " +
        "van claude.ai is gewijzigd)."
    );
    process.exit(1);
  }

  fs.writeFileSync("index.html.new", content);
  console.log(`Opgeslagen: ${content.length} bytes.`);
}

main();
