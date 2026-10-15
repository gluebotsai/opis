/**
 * Generate browser-trusted dev certs with mkcert (LAN web push).
 * Run once: npm run webpush:trust
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.join(__dirname, ".certs");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
const markerPath = path.join(certDir, ".mkcert");

const MKCERT_VERSION = "v1.4.4";
const MKCERT_URL = `https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-amd64`;
const LOCAL_BIN = path.join(os.homedir(), ".local", "bin", "mkcert");

const HOSTS = ["localhost", "127.0.0.1", "192.168.11.31"];

function ensureMkcert() {
  if (fs.existsSync(LOCAL_BIN)) return LOCAL_BIN;
  try {
    execSync("mkcert -version", { stdio: "ignore" });
    return "mkcert";
  } catch {
    /* download */
  }
  fs.mkdirSync(path.dirname(LOCAL_BIN), { recursive: true });
  execSync(`curl -sL "${MKCERT_URL}" -o "${LOCAL_BIN}"`, { stdio: "inherit" });
  fs.chmodSync(LOCAL_BIN, 0o755);
  return LOCAL_BIN;
}

function tryInstallCa(mkcert) {
  try {
    execFileSync(mkcert, ["-install"], { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function tryNssTrust(mkcert) {
  let caroot = "";
  try {
    caroot = execFileSync(mkcert, ["-CAROOT"], { encoding: "utf8" }).trim();
  } catch {
    return false;
  }
  const rootCa = path.join(caroot, "rootCA.pem");
  const nssDb = path.join(os.homedir(), ".pki", "nssdb");
  if (!fs.existsSync(rootCa) || !fs.existsSync(nssDb)) return false;

  let certutil = "certutil";
  try {
    execSync("certutil -version", { stdio: "ignore" });
  } catch {
    certutil = ensureCertutilBinary();
    if (!certutil) return false;
  }

  try {
    execFileSync(
      certutil,
      ["-d", `sql:${nssDb}`, "-A", "-t", "C,,", "-n", "mkcert development CA", "-i", rootCa],
      { stdio: "inherit" },
    );
    return true;
  } catch {
    return false;
  }
}

function ensureCertutilBinary() {
  const cacheDir = path.join(os.homedir(), ".cache", "worktual-webpush");
  const certutilPath = path.join(cacheDir, "certutil");
  if (fs.existsSync(certutilPath)) return certutilPath;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const deb = path.join(cacheDir, "libnss3-tools.deb");
    execSync(
      'apt-get download -o Dir::Cache::archives="' +
        cacheDir +
        '" libnss3-tools',
      { stdio: "ignore" },
    );
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".deb"));
    if (!files.length) return null;
    const extractDir = path.join(cacheDir, "extract");
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`dpkg-deb -x "${path.join(cacheDir, files[0])}" "${extractDir}"`, {
      stdio: "ignore",
    });
    const bin = path.join(extractDir, "usr", "bin", "certutil");
    if (!fs.existsSync(bin)) return null;
    fs.copyFileSync(bin, certutilPath);
    fs.chmodSync(certutilPath, 0o755);
    return certutilPath;
  } catch {
    return null;
  }
}

function generateCerts(mkcert) {
  fs.mkdirSync(certDir, { recursive: true });
  execFileSync(
    mkcert,
    ["-key-file", keyPath, "-cert-file", certPath, ...HOSTS],
    { stdio: "inherit", cwd: certDir },
  );
  fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`);
}

const mkcert = ensureMkcert();
console.log(`Using mkcert at ${mkcert}`);

const caInstalled = tryInstallCa(mkcert);
if (!caInstalled) {
  const nssOk = tryNssTrust(mkcert);
  if (!nssOk) {
    let caroot = "";
    try {
      caroot = execFileSync(mkcert, ["-CAROOT"], { encoding: "utf8" }).trim();
    } catch {
      /* ignore */
    }
    console.log("\nCould not auto-install the mkcert CA (needs sudo or certutil).");
    if (caroot) {
      console.log(`Trust it manually in Chrome:`);
      console.log(`  chrome://settings/certificates → Authorities → Import`);
      console.log(`  File: ${path.join(caroot, "rootCA.pem")}`);
      console.log(`Check “Trust this certificate for identifying websites”.`);
    } else {
      console.log(`Run: ${mkcert} -install   (may need sudo / apt install libnss3-tools)`);
    }
  } else {
    console.log("Installed mkcert CA into Chrome NSS store (~/.pki/nssdb).");
  }
} else {
  console.log("mkcert local CA installed in system trust store.");
}

generateCerts(mkcert);
console.log(`\nWrote ${certPath}`);
console.log(`Restart: npm run dev:webpush`);
console.log(`Then open: https://192.168.11.31:5500/`);
