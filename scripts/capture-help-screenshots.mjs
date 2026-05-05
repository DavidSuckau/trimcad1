import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const APP_URL = 'http://localhost:5173/trimcad1/'
const OUT_DIR = path.resolve('public/help-screenshots')

async function clickTopMenu(page, label) {
  await page.getByRole('button', { name: new RegExp(`^${label}$`) }).click()
  await page.waitForTimeout(150)
}

async function clickDropdownItem(page, label) {
  await page.locator('.menubar-dropdown-btn', { hasText: label }).first().click()
  await page.waitForTimeout(150)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } })

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.menubar')
  await page.waitForTimeout(600)

  // Basis-Teil erzeugen, damit Naht/Notch/Drehpunkt sinnvoll darstellbar sind.
  await clickTopMenu(page, 'Erzeugen')
  await clickDropdownItem(page, 'Rechteck')
  await page.mouse.move(740, 360)
  await page.mouse.down()
  await page.mouse.move(1090, 650)
  await page.mouse.up()
  await page.waitForTimeout(300)

  // 1) Datei -> Exportieren
  await clickTopMenu(page, 'Datei')
  const exportRow = page.locator('.menubar-dropdown-btn-submenu', { hasText: 'Exportieren' }).first()
  await exportRow.hover()
  await page.waitForSelector('.menubar-submenu')
  await page.screenshot({ path: path.join(OUT_DIR, 'datei-export.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 2) Nahtzugabe-Dialog
  await clickTopMenu(page, 'Naht')
  await page.locator('.menubar-dropdown-btn').filter({ hasText: /^Nahtzugabe/ }).first().click()
  await page.waitForTimeout(150)
  await page.waitForTimeout(150)
  await page.mouse.click(915, 505)
  await page.waitForSelector('.nahtzugabe-dialog-title')
  await page.screenshot({ path: path.join(OUT_DIR, 'nahtzugabe.png') })
  await page.locator('.nahtzugabe-dialog button', { hasText: 'Abbrechen' }).first().click()
  await page.waitForTimeout(200)

  // 3) Notch setzen (Werkzeug + Kontur-Hover)
  await clickTopMenu(page, 'Erzeugen')
  await clickDropdownItem(page, 'Notch')
  await page.mouse.move(915, 360)
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT_DIR, 'notch-setzen.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 4) Drehpunkt Alt+D auf Ecke
  await clickTopMenu(page, 'Bearbeiten')
  await clickDropdownItem(page, 'Auswahl')
  await page.mouse.move(740, 360)
  await page.waitForTimeout(150)
  await page.keyboard.down('Alt')
  await page.keyboard.press('d')
  await page.keyboard.up('Alt')
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT_DIR, 'drehpunkt-alt-d.png') })

  // 5) Nahtzuordnung-Modus
  await clickTopMenu(page, 'Naht')
  await clickDropdownItem(page, 'Nahtzuordnung')
  await page.waitForSelector('.nahtzuordnung-hint')
  await page.screenshot({ path: path.join(OUT_DIR, 'nahtzuordnung.png') })
  await page.locator('.nahtzuordnung-abbrechen').first().click()
  await page.waitForTimeout(200)

  // 6) Profil zuordnen-Modus
  await clickTopMenu(page, 'Profil')
  await clickDropdownItem(page, 'Profil zuordnen')
  await page.waitForSelector('.nahtzuordnung-hint')
  await page.screenshot({ path: path.join(OUT_DIR, 'profil-zuordnung.png') })
  await page.locator('.nahtzuordnung-abbrechen').first().click()

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
