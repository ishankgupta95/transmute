import { test, expect, type Page } from "@playwright/test";

/**
 * Output-value correctness for the calculators, parsers and encoders.
 *
 * Every expected value is derived in the test from the spec of the thing
 * (octal arithmetic, Intl, URL, Buffer, Date.UTC) rather than copied from the
 * page. Locators are scoped to `[data-tool-surface]` because the FAQ copy
 * below it repeats UI strings.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

// First hit on a route compiles it in the shared dev server; give it room.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

async function region(page: Page, name: string): Promise<string> {
  const r = surfaceOf(page).getByRole("region", { name, exact: true });
  await expect(r).toBeVisible();
  return ((await r.textContent()) ?? "").trim();
}

test.describe("chmod-calculator", () => {
  const octal = (page: Page) => surfaceOf(page).locator('input[type="text"]').nth(0);
  const symbolic = (page: Page) => surfaceOf(page).locator('input[type="text"]').nth(1);

  test("typing 755 ticks the right boxes and shows both command forms", async ({ page }) => {
    await page.goto("/chmod-calculator");
    await octal(page).fill("755");
    const want: Record<string, boolean> = {
      "Owner read": true, "Owner write": true, "Owner execute": true,
      "Group read": true, "Group write": false, "Group execute": true,
      "Other read": true, "Other write": false, "Other execute": true,
    };
    for (const [label, on] of Object.entries(want)) {
      expect(await surfaceOf(page).getByLabel(label, { exact: true }).isChecked(), label).toBe(on);
    }
    await expect(symbolic(page)).toHaveValue("rwxr-xr-x");
    expect(await region(page, "Absolute form")).toBe("chmod 755 file");
    expect(await region(page, "Symbolic form")).toBe("chmod u=rwx,go=rx file");
  });

  test("unticking a box recomputes the octal (755 minus Other read = 751)", async ({ page }) => {
    await page.goto("/chmod-calculator");
    await octal(page).fill("755");
    await surfaceOf(page).getByLabel("Other read", { exact: true }).uncheck();
    await expect(octal(page)).toHaveValue("751");
    await expect(symbolic(page)).toHaveValue("rwxr-x--x");
  });

  test("typing a symbolic string sets the octal for every digit", async ({ page }) => {
    await page.goto("/chmod-calculator");
    await symbolic(page).fill("rw-r-----");
    await expect(octal(page)).toHaveValue("640");
    expect(await region(page, "Absolute form")).toBe("chmod 640 file");
  });

  test("setuid + 755 is 4755 / rwsr-xr-x; sticky + 777 is 1777 / rwxrwxrwt", async ({ page }) => {
    await page.goto("/chmod-calculator");
    await octal(page).fill("755");
    await surfaceOf(page).getByLabel("setuid", { exact: true }).check();
    await expect(octal(page)).toHaveValue("4755");
    await expect(symbolic(page)).toHaveValue("rwsr-xr-x");
    expect(await region(page, "Absolute form")).toBe("chmod 4755 file");

    await octal(page).fill("1777");
    await expect(symbolic(page)).toHaveValue("rwxrwxrwt");
    expect(await surfaceOf(page).getByLabel("sticky", { exact: true }).isChecked()).toBe(true);
  });

  test("the path field lands in the command", async ({ page }) => {
    await page.goto("/chmod-calculator");
    await octal(page).fill("600");
    await surfaceOf(page).getByLabel("Path in the command").fill("secret.key");
    expect(await region(page, "Absolute form")).toBe("chmod 600 secret.key");
  });
});

test.describe("http-status-codes", () => {
  const search = (page: Page) => surfaceOf(page).getByPlaceholder(/429/);

  test("searching 404 shows Not Found and filtering 5xx shows only 5xx codes", async ({ page }) => {
    await page.goto("/http-status-codes");
    await search(page).fill("404");
    await expect(surfaceOf(page).getByText("Not Found").first()).toBeVisible();
    await expect(surfaceOf(page).getByText("Internal Server Error")).toHaveCount(0);

    await search(page).fill("");
    await surfaceOf(page).getByRole("button", { name: "5xx", exact: true }).click();
    const text = await surfaceOf(page).innerText();
    for (const phrase of ["Internal Server Error", "Bad Gateway", "Service Unavailable", "Gateway Timeout"]) {
      expect(text).toContain(phrase);
    }
    expect(text).not.toContain("Not Found");
    expect(text).not.toContain("Moved Permanently");
  });

  test("418 is documented as the teapot and 429 as Too Many Requests", async ({ page }) => {
    await page.goto("/http-status-codes");
    await search(page).fill("418");
    await expect(surfaceOf(page).getByText(/teapot/i).first()).toBeVisible();
    await search(page).fill("429");
    await expect(surfaceOf(page).getByText("Too Many Requests").first()).toBeVisible();
  });
});

test.describe("byte-converter", () => {
  const field = (page: Page, label: string) => surfaceOf(page).getByLabel(label, { exact: true });

  test("1048576 bytes is 1 MiB, 1024 KiB, 1.048576 MB and 8,388,608 bits", async ({ page }) => {
    await page.goto("/byte-converter");
    await field(page, "Bytes").fill("1048576");
    await expect(field(page, "Mebibytes (1024² bytes)")).toHaveValue("1");
    await expect(field(page, "Kibibytes (1024 bytes)")).toHaveValue("1,024");
    await expect(field(page, "Bits")).toHaveValue("8,388,608");
    await expect(field(page, "Kilobytes (1000 bytes)")).toHaveValue("1,048.58");
    const mb = Number((await field(page, "Megabytes (1000² bytes)").inputValue()).replace(/,/g, ""));
    expect(mb).toBeCloseTo(1.048576, 4);
  });

  test("editing megabits drives every other unit (SI vs binary kept distinct)", async ({ page }) => {
    await page.goto("/byte-converter");
    await field(page, "Gigabytes (1000³ bytes)").fill("2");
    await expect(field(page, "Bytes")).toHaveValue("2,000,000,000");
    await expect(field(page, "Megabytes (1000² bytes)")).toHaveValue("2,000");
    await expect(field(page, "Gigabits")).toHaveValue("16");
    const gib = Number((await field(page, "Gibibytes (1024³ bytes)").inputValue()).replace(/,/g, ""));
    expect(gib).toBeCloseTo(2e9 / 1024 ** 3, 4);
  });
});

test.describe("timezone-converter", () => {
  async function board(page: Page, date: string, time: string) {
    await page.goto("/timezone-converter");
    const surface = surfaceOf(page);
    await surface.getByLabel("Date", { exact: true }).fill(date);
    await surface.getByLabel("Time", { exact: true }).fill(time);
    await surface.getByLabel("Plan from this zone").selectOption("UTC");
    return surface;
  }
  const hhmm = (zone: string, iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const offset = (zone: string, iso: string) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(iso));
    const g = (t: string) => Number(f.find((p) => p.type === t)!.value);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    const mins = (asUtc - new Date(iso).setSeconds(0, 0)) / 60000;
    const sign = mins < 0 ? "-" : "+";
    const a = Math.abs(mins);
    return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  };

  for (const [label, date, time] of [
    ["summer (DST in the northern hemisphere)", "2026-07-01", "12:00"],
    ["winter", "2026-01-15", "23:45"],
  ] as const) {
    test(`board matches Intl for ${label}`, async ({ page }) => {
      const surface = await board(page, date, time);
      const iso = `${date}T${time}:00.000Z`;
      const text = (await surface.innerText()).replace(/\s+/g, " ");
      for (const zone of ["America/New_York", "Europe/London", "Asia/Kolkata", "UTC"]) {
        const re = new RegExp(`${zone.replace("/", "\\/")} ${hhmm(zone, iso)} \\w{3} \\d{4}-\\d{2}-\\d{2}( [+-]1 DAY)? ${offset(zone, iso).replace("+", "\\+")}`);
        expect(text, zone).toMatch(re);
      }
      await expect(surface.getByText(iso).first()).toBeVisible();
    });
  }

  test("a conversion that crosses midnight shows the next calendar date", async ({ page }) => {
    const surface = await board(page, "2026-01-15", "23:45");
    // Kolkata is UTC+5:30 in January -> 05:15 on the 16th.
    await expect(surface.getByText(/Asia\/Kolkata\s*05:15\s*\w{3} 2026-01-16/)).toBeVisible();
  });
});

test.describe("aspect-ratio-calculator", () => {
  const inputs = (page: Page) => surfaceOf(page).locator('input[type="text"]');

  test("1920x1080 reduces to 16:9 / 1.7778, 1366x768 to 683:384", async ({ page }) => {
    await page.goto("/aspect-ratio-calculator");
    const surface = surfaceOf(page);
    await surface.getByRole("button", { name: "Ratio", exact: true }).click();
    await inputs(page).nth(0).fill("1920");
    await inputs(page).nth(1).fill("1080");
    await expect(surface.getByText("16:9", { exact: true }).first()).toBeVisible();
    await expect(surface.getByText("1.7778", { exact: true })).toBeVisible();

    await inputs(page).nth(0).fill("1366");
    await inputs(page).nth(1).fill("768");
    await expect(surface.getByText("683:384", { exact: true }).first()).toBeVisible();
  });

  test("solving height from width and ratio gives the whole-number side", async ({ page }) => {
    await page.goto("/aspect-ratio-calculator");
    // Defaults: solve Height, width 1920, ratio 16:9 -> 1080; change width -> 1280x720.
    await inputs(page).nth(0).fill("1280");
    await expect(inputs(page).nth(1)).toHaveValue("720");
    await inputs(page).nth(2).fill("4:3");
    await expect(inputs(page).nth(1)).toHaveValue("960");
    await inputs(page).nth(2).fill("2.39:1");
    expect(Number(await inputs(page).nth(1).inputValue())).toBeCloseTo(1280 / 2.39, 0);
  });

  test("solving width from height and ratio", async ({ page }) => {
    await page.goto("/aspect-ratio-calculator");
    await surfaceOf(page).getByRole("button", { name: "Width", exact: true }).first().click();
    await inputs(page).nth(1).fill("1080");
    await inputs(page).nth(2).fill("16:9");
    await expect(inputs(page).nth(0)).toHaveValue("1920");
  });
});

test.describe("url-parser", () => {
  test("every component matches the platform URL parser, and repeated params are kept", async ({ page }) => {
    const raw = "https://user:p%40ss@Example.COM:8443/a/b%20c?tag=x&tag=y&q=a%20b&next=https%3A%2F%2Felsewhere#frag";
    const u = new URL(raw);
    await page.goto("/url-parser");
    await surfaceOf(page).locator("textarea").first().fill(raw);
    const text = (await surfaceOf(page).innerText()).replace(/[ \t]*\n[ \t]*/g, "\n");
    const pair = (k: string, v: string) => expect(text, k).toContain(`${k}\n${v}`);
    pair("protocol", u.protocol);
    pair("username", u.username);
    pair("password", u.password);
    pair("hostname", u.hostname);
    pair("port", u.port);
    pair("pathname", u.pathname);
    pair("search", u.search);
    pair("hash", u.hash);
    pair("origin", u.origin);

    // Parameter table: decoded values, duplicate key kept twice.
    const names = surfaceOf(page).getByLabel(/^Parameter \d+ name$/);
    const values = surfaceOf(page).getByLabel(/^Parameter \d+ value$/);
    const params = [...u.searchParams.entries()];
    await expect(names).toHaveCount(params.length);
    for (let i = 0; i < params.length; i++) {
      await expect(names.nth(i)).toHaveValue(params[i][0]);
      await expect(values.nth(i)).toHaveValue(params[i][1]);
    }
  });

  test("a relative reference resolves against the base URL", async ({ page }) => {
    await page.goto("/url-parser");
    await surfaceOf(page).locator("textarea").first().fill("../img/a.png?v=2");
    await surfaceOf(page).getByLabel("Base URL").fill("https://example.com/app/docs/");
    const resolved = new URL("../img/a.png?v=2", "https://example.com/app/docs/");
    await expect(surfaceOf(page)).toContainText(resolved.pathname);
    await expect(surfaceOf(page)).toContainText(resolved.hostname);
  });
});

/* ── strengthened: existing tools whose current checks are shallow ─────── */

test.describe("encoders: unicode and edge cases", () => {
  test("base64 encodes UTF-8 (not Latin-1) and decodes it back", async ({ page }) => {
    const text = "héllo ✓ 日本語 😀";
    await page.goto("/base64-encode-decode");
    await surfaceOf(page).locator("textarea").first().fill(text);
    await expect(surfaceOf(page).locator("textarea[readonly]")).toHaveValue(Buffer.from(text, "utf8").toString("base64"));

    await surfaceOf(page).getByRole("button", { name: "Decode" }).click();
    await surfaceOf(page).locator("textarea").first().fill(Buffer.from(text, "utf8").toString("base64"));
    await expect(surfaceOf(page).locator("textarea[readonly]")).toHaveValue(text);
  });

  test("url-encode matches encodeURIComponent for reserved and non-ASCII characters", async ({ page }) => {
    const text = "a b&c=d/e?f#g+h ü 日本 😀 100%";
    await page.goto("/url-encode-decode");
    await surfaceOf(page).locator("textarea").first().fill(text);
    await expect(surfaceOf(page).locator("textarea[readonly]")).toHaveValue(encodeURIComponent(text));

    await surfaceOf(page).getByRole("button", { name: "Decode" }).click();
    await surfaceOf(page).locator("textarea").first().fill(encodeURIComponent(text));
    await expect(surfaceOf(page).locator("textarea[readonly]")).toHaveValue(text);
  });

  test("jwt-decoder shows every claim, the algorithm, and flags an expired token", async ({ page }) => {
    const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = 1_600_000_000; // 2020-09-13, long past
    const token = `${seg({ alg: "HS384", typ: "JWT" })}.${seg({ sub: "u1", admin: true, aud: ["a", "b"], exp, iat: exp - 60 })}.c2ln`;
    await page.goto("/jwt-decoder");
    await surfaceOf(page).locator("textarea").first().fill(token);
    const pres = surfaceOf(page).locator("pre");
    await expect(pres.first()).toContainText('"alg": "HS384"');
    const payloadText = (await pres.nth(1).textContent()) ?? "";
    expect(JSON.parse(payloadText)).toEqual({ sub: "u1", admin: true, aud: ["a", "b"], exp, iat: exp - 60 });
    await expect(surfaceOf(page).getByText(/expired/i).first()).toBeVisible();
    await expect(surfaceOf(page)).toContainText(new Date(exp * 1000).toISOString());
  });

  test("jwt-decoder does not call a far-future token expired", async ({ page }) => {
    const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${seg({ alg: "none" })}.${seg({ exp: 4_102_444_800 })}.`;
    await page.goto("/jwt-decoder");
    await surfaceOf(page).locator("textarea").first().fill(token);
    await expect(surfaceOf(page).locator("pre").nth(1)).toContainText('"exp": 4102444800');
    await expect(surfaceOf(page).getByText(/expired/i)).toHaveCount(0);
  });

  test("html-entity decoder resolves named, decimal and hex references; encoder round-trips", async ({ page }) => {
    await page.goto("/html-entity-encode-decode");
    await surfaceOf(page).getByRole("button", { name: "Decode" }).click();
    await surfaceOf(page).locator("textarea").first().fill("&copy; &#169; &#xA9; &euro; &#x1F600; &lt;b&gt; &amp;amp;");
    await expect(surfaceOf(page).locator("textarea[readonly]")).toHaveValue("© © © € 😀 <b> &amp;");
  });
});

test.describe("regex-tester", () => {
  test("reports hit count, capture groups and honours the i flag", async ({ page }) => {
    await page.goto("/regex-tester");
    const surface = surfaceOf(page);
    await surface.getByLabel("Regex pattern").fill("(?<user>\\w+)@(\\w+)\\.com");
    await surface.getByLabel("Test string").fill("a bob@site.com x amy@corp.com y@z.org");
    await expect(page.locator("mark")).toHaveCount(2);
    await expect(page.locator("mark").nth(0)).toHaveText("bob@site.com");
    await expect(page.locator("mark").nth(1)).toHaveText("amy@corp.com");
    for (const g of ["bob", "site", "amy", "corp"]) await expect(surface).toContainText(g);
    await expect(surface).toContainText("M2 · G2");

    // Case flag: "ABC abc" has one match without i, two with it.
    await surface.getByLabel("Regex pattern").fill("abc");
    await surface.getByLabel("Test string").fill("ABC abc");
    await expect(page.locator("mark")).toHaveCount(1);
    await surface.getByRole("button", { name: "i", exact: true }).click();
    await expect(page.locator("mark")).toHaveCount(2);
  });

  test("without g only the first match is taken; m makes ^ match each line", async ({ page }) => {
    await page.goto("/regex-tester");
    const surface = surfaceOf(page);
    await surface.getByLabel("Regex pattern").fill("^\\d");
    await surface.getByLabel("Test string").fill("1a\n2b\n3c");
    await expect(page.locator("mark")).toHaveCount(1); // g only: ^ anchors at string start
    await surface.getByRole("button", { name: "m", exact: true }).click();
    await expect(page.locator("mark")).toHaveCount(3);
    await surface.getByRole("button", { name: "g", exact: true }).click();
    await expect(page.locator("mark")).toHaveCount(1);
  });
});

test.describe("cron-expression-generator", () => {
  test("next-run list is the next five Mondays at 09:00 local time", async ({ page }) => {
    await page.goto("/cron-expression-generator");
    const expected = await page.evaluate(() => {
      const out: string[] = [];
      const d = new Date();
      d.setSeconds(0, 0);
      d.setHours(9, 0, 0, 0);
      while (out.length < 5) {
        if (d.getDay() === 1 && d.getTime() > Date.now()) out.push(d.toLocaleString());
        d.setDate(d.getDate() + 1);
      }
      return out;
    });
    const list = surfaceOf(page).getByLabel("Next 5 run times");
    await expect(list).toBeVisible();
    const got = ((await list.innerText()) ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    expect(got).toEqual(expected);
  });

  test("the pickers build the expression and a 15-minute step yields 15-minute gaps", async ({ page }) => {
    await page.goto("/cron-expression-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Minute", { exact: true }).selectOption("30");
    await surface.getByLabel("Hour", { exact: true }).selectOption("2");
    await expect(surface.getByLabel("Cron expression")).toHaveValue("30 2 * * 1");

    await surface.getByLabel("Cron expression").fill("*/15 * * * *");
    const list = surface.getByLabel("Next 5 run times");
    await expect(list).toBeVisible();
    const times = await page.evaluate((txt) => txt.split("\n").map((l) => new Date(l.trim()).getTime()), await list.innerText());
    expect(times).toHaveLength(5);
    for (let i = 0; i < 5; i++) expect(new Date(times[i]).getMinutes() % 15).toBe(0);
    for (let i = 1; i < 5; i++) expect(times[i] - times[i - 1]).toBe(15 * 60_000);
  });
});

test.describe("timestamp-converter", () => {
  const fields = (page: Page) => surfaceOf(page).locator('input[type="text"]');

  test("editing ISO fills seconds and milliseconds exactly", async ({ page }) => {
    await page.goto("/timestamp-converter");
    const iso = "2024-02-29T12:34:56.789Z";
    await fields(page).nth(2).fill(iso);
    const ms = Date.parse(iso);
    await expect(fields(page).nth(1)).toHaveValue(String(ms));
    await expect(fields(page).nth(0)).toHaveValue(String(Math.floor(ms / 1000)));
  });

  test("editing milliseconds fills ISO; zero is the epoch", async ({ page }) => {
    await page.goto("/timestamp-converter");
    await fields(page).nth(1).fill("951782400000");
    await expect(fields(page).nth(2)).toHaveValue("2000-02-29T00:00:00.000Z");
    await fields(page).nth(0).fill("0");
    await expect(fields(page).nth(2)).toHaveValue("1970-01-01T00:00:00.000Z");
  });

  test("UTC display shows the UTC weekday for a known instant", async ({ page }) => {
    await page.goto("/timestamp-converter");
    await surfaceOf(page).getByRole("button", { name: "UTC", exact: true }).click();
    await fields(page).nth(0).fill("1700000000"); // Tue 2023-11-14 22:13:20 UTC
    await expect(surfaceOf(page)).toContainText("Tuesday");
    await expect(fields(page).nth(3)).toHaveValue(/2023/);
  });
});

test.describe("text-diff", () => {
  test("word diff marks the removed and the added word, leaves equal text plain", async ({ page }) => {
    await page.goto("/text-diff");
    await page.getByPlaceholder("Paste original text...").fill("the quick brown fox");
    await page.getByPlaceholder("Paste modified text...").fill("the quick red fox");
    const added = page.locator("span.bg-success\\/20");
    const removed = page.locator("span.bg-error\\/20");
    await expect(added).toHaveCount(1);
    await expect(removed).toHaveCount(1);
    await expect(added).toContainText("red");
    await expect(removed).toContainText("brown");
    await expect(page.locator("span.bg-success\\/20", { hasText: "quick" })).toHaveCount(0);
  });

  test("line diff marks exactly the changed lines (inputs ending in a newline)", async ({ page }) => {
    await page.goto("/text-diff");
    await surfaceOf(page).getByRole("button", { name: "By line", exact: true }).click();
    await page.getByPlaceholder("Paste original text...").fill("alpha\nbeta\ngamma\n");
    await page.getByPlaceholder("Paste modified text...").fill("alpha\nBETA\ngamma\ndelta\n");
    const added = page.locator("span.bg-success\\/20");
    const removed = page.locator("span.bg-error\\/20");
    await expect(removed).toHaveCount(1);
    await expect(removed).toContainText("beta");
    await expect(removed).not.toContainText("gamma");
    await expect(added).toHaveCount(2);
    expect((await added.allInnerTexts()).map((t) => t.trim())).toEqual(["BETA", "delta"]);
  });

  // Regression (fixed 2026-11-11 with jsdiff's `ignoreNewlineAtEof`): the
  // unchanged last line "gamma" has no trailing newline on the left but gains
  // one only because a line follows on the right, so jsdiff's line tokens
  // differed ("gamma" vs "gamma\n") and the UI showed an untouched line as
  // removed + re-added.
  test("an unchanged final line without a trailing newline is not flagged as changed", async ({ page }) => {
    await page.goto("/text-diff");
    await surfaceOf(page).getByRole("button", { name: "By line", exact: true }).click();
    await page.getByPlaceholder("Paste original text...").fill("alpha\nbeta\ngamma");
    await page.getByPlaceholder("Paste modified text...").fill("alpha\nBETA\ngamma\ndelta");
    // Every highlighted span, not just one: the correct diff has TWO added
    // spans (BETA, delta), and a single-element assertion cannot read both.
    const removed = page.locator("span.bg-error\\/20");
    const added = page.locator("span.bg-success\\/20");
    await expect(removed).toHaveCount(1);
    expect((await removed.allInnerTexts()).map((t) => t.trim())).toEqual(["beta"]);
    expect((await added.allInnerTexts()).map((t) => t.trim())).toEqual(["BETA", "delta"]);
  });

  test("identical texts produce no highlighted spans", async ({ page }) => {
    await page.goto("/text-diff");
    await page.getByPlaceholder("Paste original text...").fill("same text");
    await page.getByPlaceholder("Paste modified text...").fill("same text");
    await expect(page.locator("span.bg-success\\/20, span.bg-error\\/20")).toHaveCount(0);
  });
});

test.describe("text-case-converter", () => {
  test("converts mixed separators and unicode to each case", async ({ page }) => {
    await page.goto("/text-case-converter");
    await page.locator("textarea").first().fill("foo_bar-baz qux");
    const out = page.locator("textarea[readonly]");
    const cases: Array<[string, string]> = [
      ["camelCase", "fooBarBazQux"],
      ["PascalCase", "FooBarBazQux"],
      ["snake_case", "foo_bar_baz_qux"],
      ["kebab-case", "foo-bar-baz-qux"],
      ["UPPERCASE", "FOO_BAR-BAZ QUX"],
      ["Title Case", "Foo Bar Baz Qux"],
    ];
    for (const [btn, expected] of cases) {
      await page.getByRole("button", { name: btn, exact: true }).click();
      await expect(out, btn).toHaveValue(expected);
    }
    await page.locator("textarea").first().fill("Straße ÉCOLE");
    await page.getByRole("button", { name: "lowercase", exact: true }).click();
    await expect(out).toHaveValue("straße école");
    await page.getByRole("button", { name: "UPPERCASE", exact: true }).click();
    await expect(out).toHaveValue("STRASSE ÉCOLE");
  });
});

test.describe("word-counter", () => {
  test("counts agree with an independent count for a multi-paragraph text", async ({ page }) => {
    const text = "Hello world.\n\nSecond paragraph here! Third?\n\n\nFourth   one   with   gaps.";
    await page.goto("/word-counter");
    await page.getByPlaceholder(/Start typing/).fill(text);
    const stat = (label: string) =>
      surfaceOf(page).getByText(label, { exact: true }).locator("..").locator("p.text-2xl");
    const words = text.trim().split(/\s+/).length; // 10
    await expect(stat("Words")).toHaveText(String(words));
    await expect(stat("Characters")).toHaveText(String(text.length));
    await expect(stat("Characters (no spaces)")).toHaveText(String(text.replace(/\s/g, "").length));
    await expect(stat("Paragraphs")).toHaveText(String(text.split(/\n\s*\n/).filter((p) => p.trim()).length));
    await expect(stat("Sentences")).toHaveText(String((text.match(/[.!?]+(\s|$)/g) ?? []).length));
  });

  test("empty input counts zero everywhere", async ({ page }) => {
    await page.goto("/word-counter");
    for (const l of ["Words", "Characters", "Sentences", "Paragraphs"]) {
      await expect(surfaceOf(page).getByText(l, { exact: true }).locator("..").locator("p.text-2xl")).toHaveText("0");
    }
  });
});
