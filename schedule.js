/* SCHEDULE-ENGINE-START */
// All dates are "YYYY-MM-DD" strings handled as UTC midnight, so time zones never shift a day.
const SCHED = (function () {
  const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const addDays = (dt, n) => new Date(dt.getTime() + n * 864e5);
  const dow = (dt) => dt.getUTCDay();
  const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 864e5);

  // Federal Reserve bank holidays. Sunday holidays are observed Monday; Saturday holidays are not moved.
  const holidayCache = {};
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const set = new Set();
    const nth = (m, wd, n) => { const f = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(y, m, 1 + ((wd - dow(f) + 7) % 7) + 7 * (n - 1))); };
    const last = (m, wd) => { const l = new Date(Date.UTC(y, m + 1, 0)); return addDays(l, -((dow(l) - wd + 7) % 7)); };
    const fixed = (m, d) => { const dt = new Date(Date.UTC(y, m, d)); if (dow(dt) === 0) return addDays(dt, 1); if (dow(dt) === 6) return null; return dt; };
    [fixed(0, 1), nth(0, 1, 3), nth(1, 1, 3), last(4, 1), fixed(5, 19), fixed(6, 4), nth(8, 1, 1), nth(9, 1, 2), fixed(10, 11), nth(10, 4, 4), fixed(11, 25)]
      .forEach((dt) => { if (dt) set.add(iso(dt)); });
    holidayCache[y] = set;
    return set;
  }
  const isHoliday = (dt) => holidays(dt.getUTCFullYear()).has(iso(dt));
  const isBiz = (dt) => dow(dt) !== 0 && dow(dt) !== 6 && !isHoliday(dt);
  const nextBiz = (dt) => { let d = dt; while (!isBiz(d)) d = addDays(d, 1); return d; };
  const addMonths = (dt, k) => {
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + k, day = dt.getUTCDate();
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, dim)));
  };
  // Payment weekday (1=Mon..5=Fri) in the calendar week after the signing week.
  const firstWeekly = (signed, weekday) => { const mon = addDays(signed, -((dow(signed) + 6) % 7)); return addDays(mon, 7 + (weekday - 1)); };

  // Merchant payments. Daily: every business day starting the next business day after signing;
  // a bank holiday's payment is collected with the next business day's (double payment).
  // Weekly/biweekly: the payment weekday in the week after signing; weekend or holiday dates roll to the next business day.
  function payments(inp) {
    const { signed, payback, pmt, freq } = inp;
    if (!signed || !(payback > 0) || !(pmt > 0) || !freq) return null;
    const S = D(signed), out = [];
    let remaining = payback, guard = 0;
    const push = (dt, amt, note) => { const a = Math.min(amt, remaining); out.push({ date: iso(dt), amount: a, note: note || "" }); remaining -= a; };
    if (freq === "daily") {
      let d = inp.firstDate ? D(inp.firstDate) : addDays(S, 1), carry = 0;
      while (remaining > 0.005 && guard++ < 20000) {
        const w = dow(d);
        if (w === 0 || w === 6) { d = addDays(d, 1); continue; }
        if (isHoliday(d)) { carry++; d = addDays(d, 1); continue; }
        push(d, pmt * (1 + carry), carry === 1 ? "Double: bank holiday catch-up" : carry > 1 ? (carry + 1) + "x: bank holiday catch-up" : "");
        carry = 0; d = addDays(d, 1);
      }
    } else if (freq === "weekly" || freq === "biweekly") {
      const first = inp.firstDate ? D(inp.firstDate) : firstWeekly(S, inp.weekday || 5);
      const step = freq === "weekly" ? 7 : 14;
      for (let k = 0; remaining > 0.005 && guard++ < 5000; k++) {
        const sched = addDays(first, step * k), actual = nextBiz(sched);
        push(actual, pmt, iso(actual) !== iso(sched) ? "Moved from " + iso(sched) + " (weekend or holiday)" : "");
      }
    } else if (freq === "monthly") {
      const base = inp.firstDate ? D(inp.firstDate) : addMonths(S, 1);
      for (let k = 0; remaining > 0.005 && guard++ < 600; k++) {
        const sched = addMonths(base, k), actual = nextBiz(sched);
        push(actual, pmt, iso(actual) !== iso(sched) ? "Moved from " + iso(sched) + " (weekend or holiday)" : "");
      }
    } else return null;
    return out;
  }

  // Money to the merchant. Lump sum: net amount on the signing date.
  function disbursements(inp) {
    if (!inp.signed) return null;
    const S = D(inp.signed);
    if (inp.structure !== "reverse_consolidation") {
      return inp.net > 0 ? [{ date: iso(S), amount: inp.net, note: "Lump sum" }] : null;
    }
    // Reverse consolidation: amounts come from the contract's disbursement schedule (usually stepping down).
    // First disbursement on the signing date; then weekly from the signing date, or each business day.
    const list = (inp.disbSchedule || []).filter((x) => x && x.amount > 0);
    if (!list.length) return null;
    const out = [];
    let d = S;
    list.forEach((x, k) => {
      if (x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) d = D(x.date);
      else if (k > 0) d = inp.disbFreq === "daily" ? nextBiz(addDays(d, 1)) : nextBiz(addDays(S, 7 * k));
      out.push({ date: iso(d), amount: x.amount, note: "Disbursement " + (k + 1) });
    });
    return out;
  }

  // Nominal APR from dated cash flows: daily rate r where the flows net to zero, times 365.
  function apr(disb, pays, signed) {
    if (!disb || !pays || !disb.length || !pays.length) return null;
    const S = D(signed);
    const flows = disb.map((x) => [daysBetween(S, D(x.date)), x.amount]).concat(pays.map((x) => [daysBetween(S, D(x.date)), -x.amount]));
    const tin = disb.reduce((s, x) => s + x.amount, 0), tout = pays.reduce((s, x) => s + x.amount, 0);
    if (!(tout > tin)) return null;
    const npv = (r) => flows.reduce((s, [t, cf]) => s + cf / Math.pow(1 + r, t), 0);
    let lo = 0, hi = 0.01;
    while (npv(hi) < 0 && hi < 100) hi *= 2;
    if (npv(hi) < 0) return null;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (npv(mid) < 0) lo = mid; else hi = mid; }
    return ((lo + hi) / 2) * 365 * 100;
  }

  function metrics(inp, asOf) {
    const pays = payments(inp), disb = disbursements(inp);
    const m = { pays, disb, apr: null };
    if (pays) {
      const due = pays.filter((p) => p.date <= asOf);
      const scheduledPaid = due.reduce((s, p) => s + p.amount, 0);
      const missedAmt = Math.min(scheduledPaid, (inp.missed || 0) * inp.pmt);
      m.paid = scheduledPaid - missedAmt;
      m.paymentsDue = due.length;
      m.owed = inp.payback - m.paid;
      m.firstPayment = pays[0] ? pays[0].date : null;
      m.payoff = pays.length ? pays[pays.length - 1].date : null;
      m.upcoming = pays.filter((p) => p.date > asOf).slice(0, 6);
      m.missedAmt = missedAmt;
      m.doubles = pays.filter((p) => p.note && p.note.indexOf("holiday catch-up") > -1 && p.date > asOf).length;
    }
    if (disb) {
      m.disbTotal = disb.reduce((s, x) => s + x.amount, 0);
      m.disbToDate = disb.filter((x) => x.date <= asOf).reduce((s, x) => s + x.amount, 0);
      m.disbRemaining = disb.filter((x) => x.date > asOf).length;
    }
    if (pays && disb && inp.signed) m.apr = apr(disb, pays, inp.signed);
    const wk = { daily: 5, weekly: 1, biweekly: 0.5, monthly: 12 / 52 }[inp.freq];
    m.weekly = wk && inp.pmt ? inp.pmt * wk : null;
    return m;
  }

  return { payments, disbursements, metrics, apr, iso, D, isHoliday, holidays };
})();
/* SCHEDULE-ENGINE-END */

