// Расчетное ядро калькулятора. Без DOM: работает и в браузере, и в Node.
// null = BLANK() из DAX.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const GROUPS = [
    { id: "0-6", start: 0, end: 6, color: "#4CAF50" },
    { id: "7-24", start: 7, end: 24, color: "#2196F3" },
    { id: "25-34", start: 25, end: 34, color: "#FF9800" },
    { id: "35-42", start: 35, end: 42, color: "#F44336" },
  ];
  const TAIL_GROUP = { id: ">= 43", start: 43, end: 56, color: "#9e9e9e" };
  const ALL_GROUPS = GROUPS.concat([TAIL_GROUP]);
  const CHART_MAX_DAY = 42;

  const isNil = (x) => x === null || x === undefined || Number.isNaN(x);
  const nz = (x) => (isNil(x) ? 0 : x);
  const mul = (...xs) =>
    xs.some(isNil) ? null : xs.reduce((a, b) => a * b, 1);

  const divide = (a, b, alt) => {
    if (isNil(b) || b === 0) return alt === undefined ? null : alt;
    if (isNil(a)) return null;
    return a / b;
  };

  // SUMX: пустые пропускаются, если пустое все - результат BLANK
  const sumNonNull = (xs) => {
    const v = xs.filter((x) => !isNil(x));
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };

  // ядро
  function create(data) {
    const crossByDay = new Map(data.cross.map((r) => [r.day, r]));
    const survByDay = new Map(data.survival.map((r) => [r.day, r.pct]));
    const days = data.cross.map((r) => r.day).sort((a, b) => a - b);

    const row = (d) => crossByDay.get(d) || null;
    const mass = (d) => (row(d) ? row(d).mass : null);
    const feedCum = (d) => (row(d) ? row(d).feedCum : null);
    const crossConv = (d) => (row(d) ? row(d).conv : null);
    const groupOf = (d) => (row(d) ? row(d).group : null);
    const gain = (d) => (row(d) ? row(d).gain : null);

    const surv = (d) => (survByDay.has(d) ? survByDay.get(d) / 100 : null);

    const recipePrice = (groupId, recipe) => {
      switch (groupId) {
        case "0-6":
          return recipe["0-6"];
        case "7-24":
          return recipe["7-24"];
        case "25-34":
          return recipe["25-34"];
        default:
          return recipe["35-42"];
      }
    };

    const groupFeedDelta = (g, fe, feedFn) => {
      const onEnd = feedFn(fe);
      const onStart = g.start === 0 ? 0 : feedFn(g.start - 1);
      return nz(onEnd) - nz(onStart);
    };

    // ---------- справочные значения кросса ----------
    // AVERAGE(«Сырьевая себестоимость комбикорма»[Ср. стоимость, руб./кг]) по возрастной группе.
    // month = 'YYYY-MM' или null (без фильтра по дате — среднее по всем строкам)
    const priceRows = data.feedPrices || [];
    const hasPrices = priceRows.length > 0;
    const feedPrices = (month) => {
      const out = {};
      for (const g of ALL_GROUPS) {
        const v = priceRows
          .filter(
            (r) => r.group === g.id && (month == null || r.month === month),
          )
          .map((r) => r.price)
          .filter((x) => !isNil(x));
        out[g.id] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      }
      return out;
    };

    // [Индекс эффективности]: корм нараст. (г) × средняя цена группы / живая масса (г)
    const indexByActualPrice = (d, prices) =>
      divide(mul(feedCum(d), prices[groupOf(d)]), mass(d), 0);

    // Ряды для панели «Справочные значения Кросс» (дни 0..56)
    const crossReference = () => {
      const prices = feedPrices(null);
      return days.map((d) => ({
        day: d,
        index: indexByActualPrice(d, prices),
        mass: mass(d),
        gain: gain(d),
        conv: crossConv(d),
        surv: survByDay.has(d) ? survByDay.get(d) : null,
      }));
    };

    function simulate(P) {
      const U = P.uboi;
      const mU = mass(U);
      const cU = crossConv(U);

      // Вес головы по дням, г.
      const w = (d) =>
        d > U || isNil(mU) || isNil(mass(d))
          ? null
          : P.weightKg * 1000 * divide(mass(d), mU);

      // Конверсия
      const cv = (d) =>
        d > U || isNil(cU) || cU === 0 || isNil(crossConv(d))
          ? null
          : P.conv * divide(crossConv(d), cU);

      // Потребление корма с нарастающим итогом
      const feed = (d) => mul(w(d), cv(d));

      const price = (d) => recipePrice(groupOf(d), P.recipes);

      // Индек эффективности
      const idx = (d) =>
        isNil(w(d)) ? null : divide(mul(feed(d), price(d)), w(d), 0);

      // Голов с учетом сохранности
      const heads = (d) => mul(P.posadka, surv(d));

      // Стоимость потраченного корма - моделируемая
      const cost = (d) => {
        if (d > U) return null;
        const terms = GROUPS.map((g) => {
          const fe = Math.min(g.end, Math.min(d, U));
          if (g.start > fe) return 0;
          const delta = groupFeedDelta(g, fe, feed);
          return mul(delta / 1000, recipePrice(g.id, P.recipes), heads(fe));
        });
        return sumNonNull(terms);
      };

      // Живой вес, кг
      const meat = (d) => (d > U ? null : mul(heads(d), divide(w(d), 1000)));

      // Корм, съеденный текущей группой к дню dб кг на все поголовье (для подсказки)
      const feedKgInGroup = (d) => {
        if (d > U) return null;
        const g = GROUPS.find((x) => d >= x.start && d <= x.end);
        if (!g) return null;
        const fe = Math.min(g.end, Math.min(d, U));
        return mul(groupFeedDelta(g, fe, feed) / 1000, heads(fe));
      };

      const series = days.map((d) => ({
        day: d,
        group: groupOf(d),
        weight: w(d),
        conv: cv(d),
        feed: feed(d),
        index: idx(d),
        heads: heads(d),
        cost: cost(d),
        meat: meat(d),
        feedKgInGroup: feedKgInGroup(d),
      }));

      // Карточка по группам - полный период группы, но не дальше возраста убоя
      const groupCards = ALL_GROUPS.map((g) => {
        const rp = recipePrice(g.id, P.recipes);
        if (g.start > U)
          return {
            id: g.id,
            color: g.color,
            price: rp,
            cost: 0,
            feedKg: 0,
          };
        const fe = Math.min(g.end, U);
        const delta = groupFeedDelta(g, fe, feed);
        const h = heads(fe);
        return {
          id: g.id,
          color: g.color,
          price: rp,
          cost: mul(delta / 1000, rp, h),
          feedKg: mul(delta / 1000, h),
        };
      });

      const totalCost = sumNonNull(groupCards.map((x) => x.cost));
      const totalFeedKg = sumNonNull(groupCards.map((x) => x.feedKg));

      return {
        series,
        groups: groupCards.slice(0, 4),
        totalCost,
        totalFeedKg,
        program: divide(totalCost, totalFeedKg),
        indexLast: idx(U),
        meatLast: mul(P.posadka, surv(U), P.weightKg),
        headWeightKg: P.weightKg,
      };
    }

    return {
      days,
      mass,
      feedCum,
      crossConv,
      groupOf,
      surv,
      recipePrice,
      simulate,
      hasPrices,
      feedPrices,
      indexByActualPrice,
      crossReference,
    };
  }

  return {
    create,
    GROUPS,
    ALL_GROUPS,
    TAIL_GROUP,
    CHART_MAX_DAY,
    helpers: { isNil, nz, mul, divide, sumNonNull },
  };
});
