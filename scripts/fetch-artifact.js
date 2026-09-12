// Haalt de ruwe (nog niet uitgevoerde) HTML van een Claude Artifact op.
//
// Waarom dit niet met een simpele curl kan: de pagina op
// claude.ai/code/artifact/... is zelf maar een lege "shell" die via
// JavaScript een <iframe> opent naar een apart subdomein
// (*.frame.claudeusercontent.com) -- pas dat iframe bevat de echte
// catalogus-HTML. curl voert geen JavaScript uit en ziet dus nooit de
// echte inhoud, ongeacht de share-instellingen. Dit script gebruikt
// daarom een echte (headless) browser via Playwright om dat iframe te
// laten laden.
//
// BELANGRIJK -- waarom we het NETWERKANTWOORD onderscheppen in plaats
// van de DOM van het iframe uit te lezen (frame.content()): de
// catalogus-pagina bevat zijn eigen <script> dat bij het laden de
// tabbladen/kaarten opbouwt. Als je in plaats daarvan de *al
// gerenderde* DOM opslaat (na uitvoering), zit dat resultaat er al in
// EN het originele <script> zit er nog steeds in -- dus bij een verse
// laadbeurt op GitHub Pages bouwt dat script alles een tweede keer op
// bovenop wat al in de HTML stond, met dubbele tabbladen/categorieen
// tot gevolg. Door in plaats daarvan het ruwe HTTP-antwoord te pakken
// (precies de bytes die de server stuurde, voordat de browser ook maar
// iets heeft uitgevoerd), krijgen we exact hetzelfde bestand als wat
// oorspronkelijk gepubliceerd is -- dat bouwt zijn eigen inhoud maar
// een keer op, zoals bedoeld.
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

  let capturedHtml = null;

  // Onderschep elk netwerkantwoord; zodra we het HTML-document van het
  // content-iframe zien dat er echt uitziet als onze catalogus, bewaren
  // we de RUWE tekst (nog niets uitgevoerd/gewijzigd door de browser).
  page.on("response", async (response) => {
    if (capturedHtml) return;
    const url = response.url();
    if (!url.includes("frame.claudeusercontent.com")) return;
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("text/html")) return;
    try {
      const body = await response.text();
      if (body.includes("TOOL_DATA")) {
        capturedHtml = body;
      }
    } catch (e) {
      // Antwoord kon niet gelezen worden (bv. omgeleid/vervangen); negeren.
    }
  });

  try {
    await page.goto(ARTIFACT_URL, { waitUntil: "networkidle", timeout: 60000 });
  } catch (e) {
    console.error("Kon de artifact-pagina niet laden:", e.message);
  }

  // Geef het iframe wat extra tijd, voor het geval het antwoord na
  // "networkidle" nog binnenkomt.
  await page.waitForTimeout(4000);

  await browser.close();

  if (!capturedHtml) {
    console.error(
      "Kon de ruwe HTML van het content-iframe niet onderscheppen " +
        "(mogelijk bot-detectie, of de pagina-structuur van claude.ai " +
        "is gewijzigd)."
    );
    process.exit(1);
  }

  fs.writeFileSync("index.html.new", capturedHtml);
  console.log(`Opgeslagen: ${capturedHtml.length} bytes.`);
}

main();
