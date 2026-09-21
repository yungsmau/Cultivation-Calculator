(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const { isNil } = Engine.helpers;
  const GROUPS = Engine.GROUPS;

  // Создание элемента: el('div', {class: 'x'}, 'текст', другойЭлемент, ...)
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid);
    return e;
  }

  // Число по-русски: 9 392 667  /  45,61 ; пустое значение -> «—»
  const fmt = (n, d = 0) =>
    isNil(n) || !isFinite(n)
      ? "—"
      : n.toLocaleString("ru-RU", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        });

  // ---------- цвета ----------
  const ACCENT = "#7F56D9";
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  // цвет полосы возрастной группы для дня d (очень светлый — как фон)
  const bandColors = (days) =>
    days.map((d) => {
      const g = Engine.ALL_GROUPS.find((x) => d >= x.start && d <= x.end);
      return hexA(g ? g.color : "#9E9E9E", 0.1);
    });

  // ---------- иконки (контурные, 24×24) ----------
  const ICON = {
    model:
      '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    coins:
      '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6v2m0 8v2"/>',
    wallet:
      '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><path d="M16 14h.01"/>',
  };
  function icon(name) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.innerHTML = ICON[name];
    return s;
  }

  const PAGES = [
    {
      id: "model",
      nav: "Моделирование",
      icon: "model",
      title: "Моделирование выращивания",
      sub: "Задайте параметры слева — расчёт стоимости корма и мяса по нормативам кросса.",
    },
  ];

  let DATA = null;
  let eng = null;

  // ---------- графики (Chart.js) ----------
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#717680";

  const charts = []; // чтобы уничтожать при смене страницы

  /**
   * Линейный график. bands: true — добавить фоновые полосы возрастных групп.
   * tooltipExtra(i) — дополнительные строки подсказки для дня с индексом i.
   */
  function makeChart(canvas, { label, dec = 2, bands = false, tooltipExtra }) {
    const datasets = [
      {
        type: "line",
        label,
        data: [],
        borderColor: ACCENT,
        backgroundColor: ACCENT,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0,
        spanGaps: false,
        order: 1,
      },
    ];
    if (bands) {
      datasets.push({
        type: "bar",
        label: "Возрастные группы",
        data: [],
        backgroundColor: [],
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1,
        grouped: false,
        yAxisID: "yBand",
        order: 10,
      });
    }
    const scales = {
      x: {
        grid: { display: false },
        border: { color: "#E9EAEB" },
        ticks: { maxRotation: 0, autoSkip: true },
      },
      y: {
        grid: { color: "#E9EAEB" },
        border: { display: false },
        ticks: { callback: (v) => v.toLocaleString("ru-RU") },
      },
    };
    if (bands) scales.yBand = { display: false, min: 0, max: 1 };

    const chart = new Chart(canvas, {
      type: "line",
      data: { labels: [], datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 8, right: 8 } },
        interaction: { mode: "index", intersect: false },
        scales,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#181D27",
            titleColor: "#fff",
            bodyColor: "#fff",
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            filter: (it) => it.dataset.type !== "bar", // полосы в подсказку не попадают
            callbacks: {
              title: (items) => (items.length ? "День " + items[0].label : ""),
              label: (it) => `${it.dataset.label}: ${fmt(it.parsed.y, dec)}`,
              afterBody: (items) =>
                tooltipExtra && items.length
                  ? tooltipExtra(items[0].dataIndex)
                  : [],
            },
          },
        },
      },
    });
    charts.push(chart);
    return chart;
  }

  // Подмена данных без анимации. bandColorList — цвета полос (только для графика с полосами)
  function setData(chart, labels, values, bandColorList) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    const b = chart.data.datasets[1];
    if (b) {
      b.data = labels.map(() => 1);
      b.backgroundColor = bandColorList;
    }
    chart.update("none");
  }

  // Панель с графиком
  function chartPanel(title, canvas, height, ...above) {
    return el(
      "section",
      { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, title)),
      el(
        "div",
        { class: "panel-body" },
        ...above,
        el("div", { class: "chart-wrap " + height }, canvas),
      ),
    );
  }

  // ---------- состояние ----------
  const S = {
    uboi: 40,
    weight: 2.5,
    conv: 1.5,
    posadka: 50000,
    r06: 35.89,
    r724: 31.98,
    r2534: 29.49,
    r3542: 28.54,
  };
  const DEFAULTS = { ...S }; // для кнопки «Сбросить» (без 'ref': это вид, а не параметр расчёта)
  S.ref = 0; // показывать ли справочные значения кросса
  const RECIPE_KEY = {
    "0-6": "r06",
    "7-24": "r724",
    "25-34": "r2534",
    "35-42": "r3542",
  };
  const recipes = () => ({
    "0-6": S.r06,
    "7-24": S.r724,
    "25-34": S.r2534,
    "35-42": S.r3542,
  });

  const bound = {}; // ключ параметра -> функции, обновляющие его контролы
  const cards = {}; // id -> элемент, в который пишем значение
  let current = null; // текущая страница
  let raf = 0;

  // Меняем параметр: контролы обновляем сразу, пересчёт — один раз за кадр
  function setState(key, value) {
    S[key] = value;
    (bound[key] || []).forEach((f) => f(value));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => current && current.update());
  }
  const setCard = (id, text) => {
    if (cards[id]) cards[id].textContent = text;
  };

  // ---------- компоненты ----------
  // Слайдер: название + поле [−] значение [+] в одной строке, ползунок ниже.
  // color — точка цвета группы у названия
  function slider({ key, label, min, max, step, decimals = 2, color }) {
    const range = el("input", {
      type: "range",
      min,
      max,
      step,
      value: S[key],
      "aria-label": label,
    });
    const num = el("input", {
      type: "number",
      min,
      max,
      step,
      value: S[key],
      inputmode: "decimal",
      "aria-label": label,
    });
    const minus = el(
      "button",
      { type: "button", class: "step", "aria-label": "Меньше" },
      "−",
    );
    const plus = el(
      "button",
      { type: "button", class: "step", "aria-label": "Больше" },
      "+",
    );
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const paint = (v) =>
      range.style.setProperty("--pct", ((v - min) / (max - min)) * 100 + "%");
    paint(S[key]);

    // шаг кнопками; toFixed убирает «хвосты» вида 0.30000000000000004
    const nudge = (dir) =>
      setState(key, clamp(+(S[key] + dir * step).toFixed(decimals)));
    minus.addEventListener("click", () => nudge(-1));
    plus.addEventListener("click", () => nudge(1));

    range.addEventListener("input", () => setState(key, Number(range.value)));
    num.addEventListener("input", () => {
      const v = Number(num.value);
      if (num.value !== "" && Number.isFinite(v)) setState(key, clamp(v));
    });
    num.addEventListener("blur", () => {
      num.value = S[key];
    });

    (bound[key] = bound[key] || []).push((v) => {
      paint(v);
      if (document.activeElement !== range) range.value = v;
      if (document.activeElement !== num) num.value = +v.toFixed(decimals);
    });

    const name = el(
      "label",
      {},
      color ? el("span", { class: "dot", style: `background:${color}` }) : null,
      label,
    );
    return el(
      "div",
      { class: "slider" },
      name,
      el("div", { class: "num-field" }, minus, num, plus),
      range,
    );
  }

  // Переключатель (0/1 в состоянии)
  function switchControl({ key, label }) {
    const b = el(
      "button",
      {
        type: "button",
        class: "switch",
        role: "switch",
        "aria-checked": String(!!S[key]),
      },
      el("span", { class: "sw-track" }, el("span", { class: "sw-thumb" })),
      el("span", {}, label),
    );
    b.addEventListener("click", () => setState(key, S[key] ? 0 : 1));
    (bound[key] = bound[key] || []).push((v) =>
      b.setAttribute("aria-checked", String(!!v)),
    );
    return b;
  }

  // KPI-карточка: иконка в рамке, подпись, крупное значение; tip — подсказка при наведении
  function kpi(id, label, iconName, tip) {
    const v = el("div", { class: "v" }, "—");
    cards[id] = v;
    const ico = el("div", { class: "kpi-ico" });
    ico.append(icon(iconName));
    return el(
      "div",
      { class: "kpi", "data-tip": tip, tabindex: "0" },
      ico,
      el("div", {}, el("div", { class: "k" }, label), v),
      el("span", { class: "kpi-info", "aria-hidden": "true" }, "i"),
    );
  }

  // Ячейка таблицы с числом
  function numCell(id) {
    const td = el("td", { class: "num" }, "—");
    cards[id] = td;
    return td;
  }

  // ---------- страница «Моделирование» ----------
  const model = {
    // root — основная область, side — блок параметров в сайдбаре
    build(root, side) {
      // --- параметры слева
      const section = (title, ...kids) =>
        el("section", { class: "side-section" }, el("h3", {}, title), ...kids);

      side.append(
        section(
          "Параметры выращивания",
          slider({
            key: "uboi",
            label: "Возраст убоя, дн.",
            min: 20,
            max: 50,
            step: 1,
            decimals: 0,
          }),
          slider({
            key: "weight",
            label: "Вес головы на последний день, кг",
            min: 1,
            max: 5,
            step: 0.1,
            decimals: 1,
          }),
          slider({
            key: "conv",
            label: "Конверсия корма",
            min: 1,
            max: 2,
            step: 0.01,
          }),
          slider({
            key: "posadka",
            label: "Посадка цыплят, гол.",
            min: 0,
            max: 100000,
            step: 500,
            decimals: 0,
          }),
        ),
        section(
          "Цены рецептов, руб./кг",
          ...GROUPS.map((g) =>
            slider({
              key: RECIPE_KEY[g.id],
              label: `Группа ${g.id} дн.`,
              min: 15,
              max: 100,
              step: 0.01,
              color: g.color,
            }),
          ),
        ),
        section(
          "Отображение",
          switchControl({ key: "ref", label: "Справочные значения кросса" }),
        ),
      );

      // --- карточки
      const kpis = el(
        "div",
        { class: "kpis" },
        kpi(
          "idx-last",
          "Индекс стоимости, руб./кг",
          "trend",
          "Стоимость корма на 1 кг живой массы в день убоя, руб./кг: Конверсия × Цена рецепта группы, в которую попадает убой.",
        ),
        kpi(
          "meat-last",
          "Живой вес, кг",
          "box",
          "Живая масса всего поголовья в день убоя: Посадка × Сохранность на день убоя × Вес головы.",
        ),
        kpi(
          "prog",
          "Корм. программа, руб./кг",
          "coins",
          "Средневзвешенная цена 1 кг корма за весь период: Стоимость корма ÷ Расход корма (кг) по всем возрастным группам. Учитывает, сколько корма съедено в каждой группе, а не просто среднее цен рецептов.",
        ),
        kpi(
          "total-cost",
          "Стоимость корма, руб.",
          "wallet",
          "Стоимость корма на всё поголовье до дня убоя: Сумма по возрастным группам (Расход корма × Цена рецепта).",
        ),
      );

      // --- графики
      const cIdx = el("canvas"),
        cW = el("canvas"),
        cCost = el("canvas");
      // строки подсказки; на графике стоимости саму стоимость не дублируем
      const tipLines = (i, withCost) => {
        const s = model.ser && model.ser[i];
        if (!s) return [];
        return [
          "",
          `Вес головы: ${fmt(s.weight, 0)} г`,
          `Голов с учётом сохранности: ${fmt(s.heads, 0)}`,
          `Корм в группе к этому дню: ${fmt(s.feedKgInGroup, 0)} кг`,
          withCost ? `Стоимость корма нараст.: ${fmt(s.cost, 0)} ₽` : null,
          `Живой вес: ${fmt(s.meat, 0)} кг`,
        ].filter((x) => x !== null);
      };
      const tip = (i) => tipLines(i, true);
      const tipNoCost = (i) => tipLines(i, false);
      model.chIdx = makeChart(cIdx, {
        label: "Индекс стоимости, руб./кг",
        dec: 2,
        tooltipExtra: tip,
      });
      model.chW = makeChart(cW, {
        label: "Вес головы, г",
        dec: 0,
        tooltipExtra: tip,
      });
      model.chCost = makeChart(cCost, {
        label: "Стоимость корма, руб",
        dec: 0,
        bands: true,
        tooltipExtra: tipNoCost,
      });

      const legend = el(
        "div",
        { class: "legend" },
        GROUPS.map((g) =>
          el(
            "span",
            {},
            el("i", { style: `background:${hexA(g.color, 0.35)}` }),
            `Группа ${g.id} дн.`,
          ),
        ),
      );

      const chartsRow = el(
        "div",
        { class: "grid-2" },
        chartPanel("Индекс стоимости выращивания, руб./кг", cIdx, "h-260"),
        chartPanel("Вес головы, г", cW, "h-260"),
      );
      const costPanel = chartPanel(
        "Стоимость корма нарастающим итогом, руб.",
        cCost,
        "h-420",
        legend,
      );

      // --- справочные значения кросса (в Power BI — скрытая группа по кнопке «Подсказка»)
      const refDefs = [
        {
          title: "Индекс стоимости выращивания, руб./кг — КРОСС",
          label: "Индекс стоимости (кросс)",
          dec: 2,
          key: "index",
          needsPrices: true,
        },
        {
          title: "Вес головы, г — КРОСС",
          label: "Живая масса, г",
          dec: 0,
          key: "mass",
        },
        {
          title: "Суточный привес, г — КРОСС",
          label: "Суточный привес, г",
          dec: 0,
          key: "gain",
        },
        {
          title: "Конверсия корма — КРОСС",
          label: "Конверсия",
          dec: 3,
          key: "conv",
        },
        {
          title: "Сохранность, % — КРОСС",
          label: "Сохранность, %",
          dec: 1,
          key: "surv",
        },
      ].filter((d) => !d.needsPrices || eng.hasPrices); // без цен корма первый график не строим
      model.refDefs = refDefs;
      const refCanvases = refDefs.map(() => el("canvas"));
      model.refCh = refDefs.map((d, i) =>
        makeChart(refCanvases[i], { label: d.label, dec: d.dec }),
      );

      const refBox = el(
        "div",
        { class: "ref page" + (S.ref ? "" : " hidden") },
        el("h2", { class: "section-title" }, "Справочные значения кросса"),
        el(
          "p",
          { class: "section-sub" },
          "Нормативы из таблицы «Кросс» по дням, без учёта ваших параметров.",
        ),
        el(
          "div",
          { class: "grid-2" },
          ...refDefs.map((d, i) =>
            chartPanel(d.title, refCanvases[i], "h-260"),
          ),
        ),
      );
      (bound.ref = bound.ref || []).push((v) =>
        refBox.classList.toggle("hidden", !v),
      );

      // --- таблица по возрастным группам
      const rows = GROUPS.map((g) =>
        el(
          "tr",
          {},
          el(
            "td",
            {},
            el(
              "div",
              { class: "gname" },
              el("span", { class: "dot", style: `background:${g.color}` }),
              `${g.id} дн.`,
            ),
          ),
          numCell("price-" + g.id),
          numCell("kg-" + g.id),
          numCell("cost-" + g.id),
        ),
      );

      const table = el(
        "section",
        { class: "panel" },
        el(
          "div",
          { class: "panel-head" },
          el("h2", {}, "Расход корма по возрастным группам"),
        ),
        el(
          "div",
          { class: "tbl-wrap" },
          el(
            "table",
            { class: "tbl" },
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", {}, "Возрастная группа"),
                el("th", { class: "num" }, "Цена, руб./кг"),
                el("th", { class: "num" }, "Потребление корма, кг"),
                el("th", { class: "num" }, "Стоимость, ₽"),
              ),
            ),
            el("tbody", {}, ...rows),
            el(
              "tfoot",
              {},
              el(
                "tr",
                {},
                el("td", {}, "Итого"),
                numCell("row-prog"),
                numCell("row-kg"),
                numCell("row-cost"),
              ),
            ),
          ),
        ),
      );

      root.append(
        kpis,
        chartsRow,
        costPanel,
        table,
        refBox,
        el(
          "p",
          { class: "footnote" },
          "В строке «Итого» цена — средневзвешенная по расходу корма (кормовая программа).",
        ),
      );
    },

    update() {
      const r = eng.simulate({
        uboi: S.uboi,
        weightKg: S.weight,
        conv: S.conv,
        posadka: S.posadka,
        recipes: recipes(),
      });

      setCard("idx-last", fmt(r.indexLast, 2));
      setCard("meat-last", fmt(r.meatLast, 0));
      setCard("prog", fmt(r.program, 2));
      setCard("total-cost", fmt(r.totalCost, 0));

      r.groups.forEach((g) => {
        setCard("price-" + g.id, fmt(g.price, 2));
        setCard("kg-" + g.id, fmt(g.feedKg, 0));
        setCard("cost-" + g.id, fmt(g.cost, 0));
      });
      setCard("row-prog", fmt(r.program, 2));
      setCard("row-kg", fmt(r.totalFeedKg, 0));
      setCard("row-cost", fmt(r.totalCost, 0));

      // графики: индекс и вес — до дня убоя; стоимость — 0..42 (после убоя линия обрывается)
      model.ser = r.series; // для подсказок
      const upto = r.series.filter((x) => x.day <= S.uboi);
      const lab = upto.map((x) => x.day);
      setData(
        model.chIdx,
        lab,
        upto.map((x) => x.index),
      );
      setData(
        model.chW,
        lab,
        upto.map((x) => x.weight),
      );

      const d42 = r.series.filter((x) => x.day <= Engine.CHART_MAX_DAY);
      const lab42 = d42.map((x) => x.day);
      setData(
        model.chCost,
        lab42,
        d42.map((x) => x.cost),
        bandColors(lab42),
      );

      // справочные значения кросса — только когда включены
      if (S.ref) {
        const ref = eng.crossReference();
        const labRef = ref.map((x) => x.day);
        model.refDefs.forEach((d, i) =>
          setData(
            model.refCh[i],
            labRef,
            ref.map((x) => x[d.key]),
          ),
        );
      }
    },
  };

  const IMPL = { model };

  // ---------- загрузка данных и навигация ----------
  async function loadData() {
    const load = (name) =>
      fetch(`data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
        return r.json();
      });
    // цены корма нужны только для одного справочного графика; без файла он просто не показывается
    const optional = (name) => load(name).catch(() => []);
    const [cross, survival, feedPrices] = await Promise.all([
      load("cross"),
      load("survival"),
      optional("feed_prices"),
    ]);
    return { cross, survival, feedPrices };
  }

  function buildTabs() {
    const nav = $("#tabs");
    for (const p of PAGES) {
      const b = el("button", { type: "button", "data-id": p.id });
      b.append(icon(p.icon), p.nav);
      b.addEventListener("click", () => show(p.id));
      nav.append(b);
    }
  }

  function show(id) {
    const page = PAGES.find((p) => p.id === id) || PAGES[0];
    $("#page-title").textContent = page.title;
    $("#page-sub").textContent = page.sub;
    $(".pagehead").classList.toggle("hidden", PAGES.lenght < 2);
    document
      .querySelectorAll("#tabs button")
      .forEach((b) =>
        b.setAttribute("aria-selected", b.dataset.id === page.id),
      );

    // сбрасываем контролы, значения и графики прошлой страницы, строим новую
    charts.forEach((c) => c.destroy());
    charts.length = 0;
    for (const k of Object.keys(bound)) delete bound[k];
    for (const k of Object.keys(cards)) delete cards[k];
    const root = $("#app");
    const side = $("#controls");
    root.replaceChildren();
    side.replaceChildren();
    current = IMPL[page.id];
    current.build(root, side);
    current.update();
  }

  async function init() {
    try {
      DATA = await loadData();
      eng = Engine.create(DATA);
    } catch (e) {
      $("#app").textContent =
        "Не удалось загрузить данные: " +
        e.message +
        ". Запустите локальный сервер (python -m http.server).";
      return;
    }
    buildTabs();
    $("#reset").addEventListener("click", () =>
      Object.keys(DEFAULTS).forEach((k) => setState(k, DEFAULTS[k])),
    );
    show(PAGES[0].id);
  }

  init();
})();
