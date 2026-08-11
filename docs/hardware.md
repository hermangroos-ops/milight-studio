# Hardware: building the radio gateway

Milight Studio does not talk to bulbs directly — it talks to an
[`esp8266_milight_hub`](https://github.com/sidoh/esp8266_milight_hub), a small board that speaks
the Mi-Light 2.4 GHz protocol. This page covers building one. Budget about €20 and an evening.

If you already run a Milight hub, skip to [Pairing your lights](#pairing-your-lights).

## Why not the WL-Box1?

The stock MiBoxer gateway has no local API, no web interface and no documented protocol; it
only talks to Futlight's cloud. There is nothing to build an app against. The ESP8266 hub
emulates the _remotes_ instead, so it works with every bulb you already own and your physical
remotes keep working alongside it.

## Parts

| Item                             | Notes                                                                                                                                    | ~Price |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ESP8266 board                    | Wemos D1 Mini or NodeMCU v2/v3                                                                                                           | €4–8   |
| NRF24L01+ radio                  | Get the **plain** version, not PA+LNA — the high-power variant often browns out on an ESP8266. Buy two or three; cheap clones fail often | €2–5   |
| 7× female-female Dupont wires    |                                                                                                                                          | €2     |
| 10–100 µF electrolytic capacitor | Across the radio's VCC/GND. This fixes most "works sometimes" problems                                                                   | €0.50  |
| Micro-USB cable + 5 V adapter    | The WL-Box1's supply will do                                                                                                             | —      |

## Wiring

| NRF24L01+ | ESP8266 GPIO | D1 Mini / NodeMCU label |
| --------- | ------------ | ----------------------- |
| VCC       | 3.3 V        | `3V3` — **never 5 V**   |
| GND       | GND          | `GND`                   |
| CE        | GPIO 4       | `D2`                    |
| CSN       | GPIO 15      | `D8`                    |
| SCK       | GPIO 14      | `D5`                    |
| MOSI      | GPIO 13      | `D7`                    |
| MISO      | GPIO 12      | `D6`                    |
| IRQ       | —            | not connected           |

Two things that make the difference between "works" and "works reliably":

- Solder the capacitor directly across the radio's VCC and GND pins. Mind the polarity — the
  stripe is the negative side.
- Keep the radio a few centimetres away from the ESP8266's own antenna. Mounting the two boards
  back to back causes interference and kills the range.

The CE and CSN pins can be changed later in the hub's web UI under **Settings → Hardware**.

## Flashing

Easiest is the project's web installer, from Chrome or Edge on a desktop (it uses Web Serial,
so it does not work from a phone):

1. Open <https://github.com/sidoh/esp8266_milight_hub> and follow the link to the web installer,
   or download the latest `.bin` for your board from the Releases page.
2. Plug the board in over USB and flash from the browser.

Command line alternative:

```bash
pip install esptool
esptool.py --port /dev/ttyUSB0 write_flash 0x0 esp8266_milight_hub_nodemcuv2.bin
# On Windows the port looks like COM3
```

## First boot

1. Power the board. It opens a Wi-Fi access point called something like `ESPxxxxx`.
2. Connect to it from a phone; a captive portal opens. If it does not, browse to
   `192.168.4.1`.
3. Choose your home Wi-Fi — it must be a **2.4 GHz** network — and enter the password.
4. Find the hub's address in your router's client list and open it in a browser. You should see
   the Milight Hub web UI.
5. Give it a DHCP reservation so the address never changes, then set `MILIGHT_HUB_URL` in
   Milight Studio to `http://<that address>`.

## Pairing your lights

Every MiBoxer bulb listens to a **(remote type + device id + group)** triple. The hub can
emulate an unlimited number of virtual remotes, so each bulb can get its own address — that is
what makes per-bulb control possible.

### Option A — take over your existing remotes (no re-pairing)

1. In the hub's web UI, open the **Sniff** / traffic view.
2. Press a button on your physical remote, standing near the hub.
3. The captured packet shows the **device id** (e.g. `0x1f2a`), the **remote type**
   (`rgb_cct`, `cct`, `fut089`, …) and the **group**.
4. Enter those three values in Milight Studio's **Lamp toevoegen** form. The app now controls
   exactly what that remote controls, and the remote keeps working.

### Option B — pair fresh

1. Add the light in Milight Studio with a remote type matching your bulb (`rgb_cct` for RGB+CCT
   bulbs, `cct` for dual white, `fut089` for the 8-zone remote), any device id you like
   (`0x1234`), and group 1.
2. Power-cycle the bulb, and **within about three seconds** press **Koppelen** on the light.
   The bulb blinks to confirm.
3. Repeat with a different group (or a different device id) per bulb to control them
   individually.

Test on/off, brightness and colour from the app before building groups and scenes.

## Troubleshooting

| Symptom                                          | What to try                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Web UI works, bulbs do not respond               | Almost always a faulty NRF24 clone. Swap in a spare. Then check the wiring, then add the capacitor                           |
| Works sometimes                                  | Add or replace the 100 µF capacitor, move the radio away from the ESP antenna, solder instead of using loose jumpers         |
| Short range                                      | Avoid PA+LNA modules — they draw more than the ESP can supply. Place the hub centrally                                       |
| Hub will not join Wi-Fi                          | 2.4 GHz only; temporarily disable band steering on the router                                                                |
| Commands are dropped when several arrive at once | Raise `MILIGHT_HUB_MIN_GAP_MS` (try 80 or 120)                                                                               |
| The app says the hub is unreachable              | Check `MILIGHT_HUB_URL`, and that `http://<hub>/about` answers from the machine running Milight Studio                       |
| A bulb ignores one specific command              | Check the remote type — a `cct` bulb has no colour, an `rgb` bulb has no colour temperature. The app hides what it cannot do |
