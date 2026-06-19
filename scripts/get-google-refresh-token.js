import http from "node:http";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { google } from "googleapis";

const REDIRECT_URI = "http://127.0.0.1:3000/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const rl = readline.createInterface({ input, output });

const clientId = await ask("GOOGLE_CLIENT_ID");
const clientSecret = await ask("GOOGLE_CLIENT_SECRET");
rl.close();

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
const url = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [SCOPE],
});

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, REDIRECT_URI);
    if (reqUrl.pathname !== "/oauth2callback") {
      res.end("Waiting for Google OAuth callback...");
      return;
    }

    const code = reqUrl.searchParams.get("code");
    if (!code) throw new Error("No code in callback URL");

    const { tokens } = await oauth2.getToken(code);

    res.end("OK. You can close this tab and return to the terminal.");
    server.close();

    console.log("\nGOOGLE_REFRESH_TOKEN:");
    console.log(tokens.refresh_token || "(no refresh_token returned)");
    console.log("");
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err.message || err));
    console.error(err);
    server.close();
  }
});

server.listen(3000, "127.0.0.1", () => {
  console.log("\nOpen this URL in your browser:\n");
  console.log(url);
  console.log("\nAfter approval, this terminal will print GOOGLE_REFRESH_TOKEN.\n");
});

async function ask(name) {
  const value = (await rl.question(`${name}: `)).trim();
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return value;
}
