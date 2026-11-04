(() => {
  "use strict";

  const STORAGE_KEY = "aucost.data.v1";
  const SCHEMA_VERSION = 1;
  const METHODS = ["微信", "支付宝", "银行卡", "信用卡", "现金", "其他"];
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const CATEGORY_COLORS = ["#34363a", "#b45d75", "#9fa2a6", "#efaec2", "#657b7e", "#c7b8ae", "#dfe3e2"];
  const PAGE_META = {
    overview: ["我的记帐", "看清每一笔钱，过更有把握的生活。"],
    ledger: ["收支流水", "所有账目，一处查清。"],
    categories: ["分类管理", "按你的方式整理每一笔收支。"],
    budget: ["月度预算", "给消费设定边界，也给自己留出余地。"],
    data: ["数据与工具", "导入、导出和备份，数据始终由你掌握。"]
  };
  const MAPPING_FIELDS = [
    { key: "date", label: "日期", required: true },
    { key: "type", label: "收支类型" },
    { key: "amount", label: "金额", required: true },
    { key: "merchant", label: "商户 / 摘要" },
    { key: "primary", label: "一级分类" },
    { key: "secondary", label: "二级分类" },
    { key: "note", label: "备注" },
    { key: "method", label: "支付方式" }
  ];

  let state;
  let selectedMonth = currentMonthKey();
  let activeView = "overview";
  let smartDraft = null;
  let speechRecognition = null;
  let voiceListening = false;
  let importSession = null;
  let importPreviewRows = [];
  let lastFocusedElement = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function uid(prefix = "id") {
    if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function currentMonthKey() {
    return localDateString().slice(0, 7);
  }

  function parseLocalDate(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day || 1);
  }

  function monthLabel(monthKey) {
    const [year, month] = monthKey.split("-");
    return `${year}年${Number(month)}月`;
  }

  function shiftMonth(monthKey, offset) {
    const [year, month] = monthKey.split("-").map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function previousMonthKey(monthKey) {
    return shiftMonth(monthKey, -1);
  }

  function daysInMonth(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month, 0).getDate();
  }

  function formatMoney(value, decimals = 2) {
    return `¥${Number(value || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}`;
  }

  function formatCompactMoney(value) {
    const amount = Number(value || 0);
    if (Math.abs(amount) >= 10000) return `¥${(amount / 10000).toFixed(1)}万`;
    return formatMoney(amount, Number.isInteger(amount) ? 0 : 2);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeCsv(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function iconUse(name) {
    return `<svg class="icon"><use href="#i-${name}"></use></svg>`;
  }

  function buildDefaultCategories() {
    const primaryId = (type, key) => `${type === "expense" ? "exp" : "inc"}-${key}`;
    const child = (primary, key, name) => ({
      id: `${primary}-${key}`,
      name,
      active: true
    });
    const make = (type, key, name, icon, keywords, children) => {
      const id = primaryId(type, key);
      return {
        id,
        name,
        icon,
        keywords,
        active: true,
        children: children.map(([childKey, childName, childKeywords]) => ({
          ...child(id, childKey, childName),
          keywords: childKeywords || []
        }))
      };
    };

    return {
      expense: [
        make("expense", "food", "餐饮", "🍜", ["吃", "饭", "餐", "外卖", "咖啡", "奶茶", "零食"], [
          ["breakfast", "早餐", ["早餐", "早饭", "包子", "豆浆", "油条"]],
          ["lunch", "午餐", ["午餐", "午饭", "中饭", "食堂", "快餐"]],
          ["dinner", "晚餐", ["晚餐", "晚饭", "夜宵"]],
          ["takeout", "外卖", ["外卖", "美团外卖", "饿了么"]],
          ["drink", "咖啡饮品", ["咖啡", "拿铁", "美式", "星巴克", "瑞幸", "奶茶", "果茶"]],
          ["snack", "零食", ["零食", "水果", "甜品", "面包"]],
          ["food-other", "其他餐饮", ["餐厅", "火锅", "烧烤", "吃饭", "聚餐"]]
        ]),
        make("expense", "transport", "交通", "🚕", ["交通", "出行"], [
          ["public", "公共交通", ["地铁", "公交", "乘车码", "轻轨"]],
          ["taxi", "打车", ["打车", "滴滴", "出租", "网约车", "曹操"]],
          ["fuel", "加油", ["加油", "油费", "汽油"]],
          ["parking", "停车", ["停车", "车位"]],
          ["travel", "长途出行", ["高铁", "机票", "火车", "飞机", "长途"]]
        ]),
        make("expense", "shopping", "购物", "🛍️", ["购物", "买", "购买"], [
          ["daily", "日用品", ["日用", "纸巾", "洗衣液", "超市", "盒马"]],
          ["clothes", "服饰", ["衣服", "鞋", "裤", "外套", "服饰"]],
          ["digital", "数码", ["电脑", "手机", "耳机", "相机", "数码"]],
          ["online", "网购", ["淘宝", "京东", "拼多多", "网购"]],
          ["shopping-other", "其他购物", ["商场", "商店"]]
        ]),
        make("expense", "housing", "居住", "🏠", ["居住", "住房"], [
          ["rent", "房租", ["房租", "租金"]],
          ["utilities", "水电燃气", ["水费", "电费", "燃气", "水电"]],
          ["property", "物业", ["物业费", "物业"]],
          ["home", "家居", ["家居", "家具", "装修"]]
        ]),
        make("expense", "fun", "娱乐", "🎬", ["娱乐", "休闲"], [
          ["movie", "电影演出", ["电影", "演出", "话剧", "演唱会"]],
          ["games", "游戏", ["游戏", "点卡"]],
          ["subscription", "订阅会员", ["视频会员", "音乐会员", "软件订阅", "会员"]],
          ["leisure", "休闲活动", ["KTV", "酒吧", "桌游", "密室"]]
        ]),
        make("expense", "health", "健康", "🌿", ["健康", "医疗"], [
          ["medical", "医疗", ["医院", "挂号", "门诊", "看病"]],
          ["medicine", "药品", ["药", "药店"]],
          ["fitness", "健身", ["健身", "瑜伽", "运动"]],
          ["insurance", "保险", ["保险"]]
        ]),
        make("expense", "education", "教育", "📚", ["教育", "学习"], [
          ["books", "书籍", ["书", "书店", "图书"]],
          ["course", "课程", ["课程", "网课", "培训"]],
          ["tuition", "学费", ["学费"]],
          ["stationery", "文具", ["文具", "笔", "本子"]]
        ]),
        make("expense", "social", "人情往来", "🎁", ["人情", "礼物"], [
          ["gift", "礼物", ["礼物", "礼品"]],
          ["redpacket", "红包", ["发红包", "随礼"]],
          ["treat", "聚餐请客", ["请客", "聚餐"]],
          ["charity", "公益", ["公益", "捐款"]]
        ]),
        make("expense", "communication", "通讯", "📱", ["通讯", "手机费"], [
          ["phone", "话费", ["话费", "流量", "手机充值"]],
          ["broadband", "宽带", ["宽带"]]
        ]),
        make("expense", "other", "其他", "✨", ["其他"], [
          ["expense-other", "其他支出", ["其他"]]
        ])
      ],
      income: [
        make("income", "work", "工作收入", "💼", ["工资", "工作", "薪酬"], [
          ["salary", "工资", ["工资", "薪资", "薪水"]],
          ["bonus", "奖金", ["奖金", "绩效"]],
          ["overtime", "加班费", ["加班费", "加班"]],
          ["subsidy", "补贴", ["补贴", "津贴"]]
        ]),
        make("income", "business", "经营收入", "🏪", ["经营", "营业", "生意"], [
          ["operation", "营业收入", ["营业收入", "营业额", "收款"]],
          ["project", "项目收入", ["项目", "客户", "合同"]]
        ]),
        make("income", "investment", "投资收入", "📈", ["投资", "理财"], [
          ["interest", "利息", ["利息", "存款利息"]],
          ["dividend", "分红", ["分红", "股息"]],
          ["returns", "理财收益", ["理财", "基金收益", "股票收益"]]
        ]),
        make("income", "other-income", "其他收入", "💸", ["收入", "其他"], [
          ["reimbursement", "报销", ["报销"]],
          ["refund", "退款", ["退款", "退货"]],
          ["redpacket-income", "红包收入", ["收红包", "红包到账"]],
          ["income-other", "其他收入", ["其他"]]
        ])
      ]
    };
  }

  function createBaseState(demo = false) {
    return {
      version: SCHEMA_VERSION,
      categories: buildDefaultCategories(),
      transactions: [],
      budgets: {},
      rules: [],
      demo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function dateDaysAgo(days, hour = 12) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(hour, 0, 0, 0);
    return localDateString(date);
  }

  function txFromSeed(daysAgo, type, amount, primary, secondary, merchant, note, method, hour = 12) {
    const date = dateDaysAgo(daysAgo, hour);
    const createdAt = new Date(`${date}T${String(hour).padStart(2, "0")}:20:00`).toISOString();
    const typePrefix = type === "income" ? "inc" : "exp";
    return {
      id: uid("tx"),
      type,
      amount,
      primaryCategoryId: `${typePrefix}-${primary}`,
      secondaryCategoryId: `${typePrefix}-${primary}-${secondary}`,
      merchant,
      note,
      method,
      date,
      createdAt
    };
  }

  function buildDemoState() {
    const demo = createBaseState(true);
    const rows = [
      [0, "expense", 28, "food", "drink", "Manner Coffee", "上午一杯拿铁", "微信", 9],
      [0, "expense", 36, "food", "lunch", "山野食堂", "工作日午餐", "支付宝", 12],
      [0, "expense", 42, "transport", "taxi", "滴滴出行", "下班回家", "微信", 19],
      [0, "expense", 18, "food", "breakfast", "街角面包房", "早餐", "微信", 8],
      [1, "expense", 128, "shopping", "daily", "盒马鲜生", "一周的水果和日用品", "支付宝", 18],
      [1, "expense", 68, "fun", "movie", "百老汇影城", "周末电影票", "微信", 20],
      [1, "expense", 15, "transport", "public", "地铁乘车码", "通勤", "支付宝", 9],
      [2, "expense", 55, "food", "dinner", "木屋烧烤", "朋友小聚", "微信", 21],
      [2, "expense", 260, "shopping", "clothes", "优衣库", "换季外套", "信用卡", 16],
      [3, "expense", 86, "health", "medicine", "益丰大药房", "常用药", "支付宝", 15],
      [2, "income", 12000, "work", "salary", "月度工资", "工资到账", "银行卡", 10],
      [4, "expense", 2800, "housing", "rent", "房屋租金", "本月房租", "银行卡", 11],
      [5, "expense", 89, "education", "books", "西西弗书店", "两本新书", "微信", 14],
      [6, "expense", 168, "fun", "subscription", "年度会员", "视频平台会员", "微信", 17],
      [2, "income", 680, "business", "project", "设计项目尾款", "外部项目收入", "银行卡", 16],
      [8, "expense", 230, "transport", "fuel", "中石化", "汽车加油", "信用卡", 18],
      [9, "expense", 42, "food", "takeout", "美团外卖", "晚饭外卖", "微信", 19],
      [10, "expense", 120, "social", "gift", "花礼", "朋友生日礼物", "支付宝", 13],
      [11, "expense", 198, "communication", "phone", "中国移动", "手机话费", "微信", 9],
      [12, "expense", 26, "food", "snack", "鲜丰水果", "水果", "支付宝", 16],
      [14, "expense", 58, "health", "fitness", "超级猩猩", "单次课程", "微信", 18]
    ];
    demo.transactions = rows.map((row) => txFromSeed(...row));
    demo.budgets[currentMonthKey()] = {
      total: 6500,
      categories: {
        "exp-food": 1600,
        "exp-transport": 650,
        "exp-shopping": 1100,
        "exp-housing": 2800,
        "exp-fun": 500,
        "exp-health": 450,
        "exp-education": 300
      }
    };
    return demo;
  }

  function normalizeState(input) {
    if (!input || typeof input !== "object") throw new Error("账本数据结构无效");
    const categories = input.categories;
    if (!categories || !Array.isArray(categories.expense) || !Array.isArray(categories.income)) {
      throw new Error("账本缺少分类数据");
    }
    if (!Array.isArray(input.transactions)) throw new Error("账本缺少流水数据");

    const normalized = {
      version: SCHEMA_VERSION,
      categories: {
        expense: categories.expense.map(normalizePrimaryCategory),
        income: categories.income.map(normalizePrimaryCategory)
      },
      transactions: input.transactions.map((tx) => ({
        id: String(tx.id || uid("tx")),
        type: tx.type === "income" ? "income" : "expense",
        amount: Math.abs(Number(tx.amount) || 0),
        primaryCategoryId: String(tx.primaryCategoryId || ""),
        secondaryCategoryId: String(tx.secondaryCategoryId || ""),
        merchant: String(tx.merchant || ""),
        note: String(tx.note || ""),
        method: METHODS.includes(tx.method) ? tx.method : String(tx.method || "其他"),
        date: /^\d{4}-\d{2}-\d{2}$/.test(tx.date) ? tx.date : localDateString(),
        createdAt: String(tx.createdAt || new Date().toISOString())
      })),
      budgets: normalizeBudgets(input.budgets),
      rules: Array.isArray(input.rules) ? input.rules.filter((rule) => rule && rule.merchant).map((rule) => ({
        id: String(rule.id || uid("rule")),
        merchant: String(rule.merchant),
        normalizedMerchant: String(rule.normalizedMerchant || normalizeMerchant(rule.merchant)),
        type: rule.type === "income" ? "income" : "expense",
        primaryCategoryId: String(rule.primaryCategoryId || ""),
        secondaryCategoryId: String(rule.secondaryCategoryId || "")
      })) : [],
      demo: Boolean(input.demo),
      createdAt: String(input.createdAt || new Date().toISOString()),
      updatedAt: String(input.updatedAt || new Date().toISOString())
    };
    dedupeRules(normalized);
    return normalized;
  }

  function normalizePrimaryCategory(category) {
    if (!category || typeof category !== "object") throw new Error("存在无效分类");
    const id = String(category.id || uid("cat"));
    return {
      id,
      name: String(category.name || "未命名分类"),
      icon: String(category.icon || "✨"),
      keywords: Array.isArray(category.keywords) ? category.keywords.map(String) : [],
      active: category.active !== false,
      children: Array.isArray(category.children) ? category.children.map((child) => ({
        id: String(child.id || uid("sub")),
        name: String(child.name || "未命名分类"),
        keywords: Array.isArray(child.keywords) ? child.keywords.map(String) : [],
        active: child.active !== false
      })) : []
    };
  }

  function normalizeBudgets(budgets) {
    if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) return {};
    return Object.fromEntries(Object.entries(budgets).map(([month, budget]) => {
      const categoryBudget = budget?.categories && typeof budget.categories === "object" ? budget.categories : {};
      return [month, {
        total: Math.max(0, Number(budget?.total) || 0),
        categories: Object.fromEntries(Object.entries(categoryBudget).map(([id, amount]) => [
          String(id),
          Math.max(0, Number(amount) || 0)
        ]))
      }];
    }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = buildDemoState();
        saveState(false);
        return;
      }
      state = normalizeState(JSON.parse(raw));
    } catch (error) {
      console.error("读取账本失败", error);
      state = createBaseState(false);
      saveState(false);
      setTimeout(() => showToast("原账本读取失败，已创建空白账本。", "error"), 0);
    }
  }

  function saveState(showError = true) {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error("保存账本失败", error);
      if (showError) showToast("浏览器存储空间不足，暂时无法保存。", "error");
      return false;
    }
  }

  function getAllPrimary(type) {
    return state.categories[type] || [];
  }

  function findPrimary(type, id) {
    return getAllPrimary(type).find((category) => category.id === id) || null;
  }

  function findSecondary(type, primaryId, id) {
    return findPrimary(type, primaryId)?.children.find((child) => child.id === id) || null;
  }

  function resolveCategory(tx) {
    const primary = findPrimary(tx.type, tx.primaryCategoryId);
    const secondary = primary?.children.find((child) => child.id === tx.secondaryCategoryId);
    return {
      primary: primary || { id: "", name: "未分类", icon: "✨" },
      secondary: secondary || { id: "", name: "未分类", active: true }
    };
  }

  function getMonthTransactions(month = selectedMonth) {
    return state.transactions.filter((tx) => tx.date.startsWith(month));
  }

  function summarizeTransactions(transactions) {
    return transactions.reduce((summary, tx) => {
      summary[tx.type] += Number(tx.amount) || 0;
      summary.count += 1;
      return summary;
    }, { income: 0, expense: 0, count: 0 });
  }

  function expenseByPrimary(transactions) {
    const result = new Map();
    transactions.filter((tx) => tx.type === "expense").forEach((tx) => {
      const resolved = resolveCategory(tx);
      const key = resolved.primary.id || "unclassified";
      const current = result.get(key) || {
        id: key,
        name: resolved.primary.name,
        icon: resolved.primary.icon,
        amount: 0
      };
      current.amount += tx.amount;
      result.set(key, current);
    });
    return Array.from(result.values()).sort((a, b) => b.amount - a.amount);
  }

  function normalizeMerchant(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/微信(支付)?|支付宝|银行卡|信用卡|现金/g, "")
      .replace(/付款|支付|消费|花了|买了|收入|到账|收到|元|块|人民币|rmb/gi, "")
      .replace(/[\s,，。.!！?？:：;；'"“”‘’\-_/\\|]/g, "")
      .trim();
  }

  function paymentMethodFromText(text) {
    const value = String(text || "").toLowerCase();
    if (/微信/.test(value)) return "微信";
    if (/支付宝/.test(value)) return "支付宝";
    if (/信用卡/.test(value)) return "信用卡";
    if (/银行卡|储蓄卡|银行卡到账/.test(value)) return "银行卡";
    if (/现金/.test(value)) return "现金";
    return "其他";
  }

  function removeDateExpressions(text) {
    return String(text)
      .replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}[日号]?/g, " ")
      .replace(/\d{1,2}月\d{1,2}[日号]?/g, " ")
      .replace(/(大前天|前天|昨天|今天)/g, " ")
      .replace(/\b\d{1,2}:\d{2}\b/g, " ");
  }

  function detectAmount(text) {
    const cleaned = removeDateExpressions(text).replace(/,/g, "");
    const amountPatterns = [
      /(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/,
      /(\d+(?:\.\d{1,2})?)\s*(?:元|块钱?|人民币|rmb)/i,
      /(?:花了|消费|支出|收入|到账|付款|付了|收了|工资|奖金|转了|买|共计|总价|金额)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/
    ];
    for (const pattern of amountPatterns) {
      const match = cleaned.match(pattern);
      if (match) return Number(match[1]);
    }
    const candidates = cleaned.match(/(?:^|[^\d])(\d{1,8}(?:\.\d{1,2})?)(?=$|[^\d])/g);
    if (!candidates?.length) return 0;
    const value = Number(candidates[candidates.length - 1].replace(/[^\d.]/g, ""));
    return Number.isFinite(value) ? value : 0;
  }

  function detectType(text) {
    const value = String(text || "").toLowerCase();
    if (/收入|工资|薪资|奖金|绩效|报销|退款|退货|到账|收到|收款|利息|分红|收益|赚了|入账/.test(value)) {
      return "income";
    }
    return "expense";
  }

  function detectDate(text) {
    const value = String(text || "");
    const now = new Date();
    if (/大前天/.test(value)) {
      now.setDate(now.getDate() - 3);
      return localDateString(now);
    }
    if (/前天/.test(value)) {
      now.setDate(now.getDate() - 2);
      return localDateString(now);
    }
    if (/昨天/.test(value)) {
      now.setDate(now.getDate() - 1);
      return localDateString(now);
    }
    if (/今天|刚刚/.test(value)) return localDateString();

    const iso = value.match(/(?:^|\D)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/);
    if (iso) return normalizeDateParts(iso[1], iso[2], iso[3]);
    const monthDay = value.match(/(?:^|\D)(\d{1,2})月(\d{1,2})[日号]?/);
    if (monthDay) return normalizeDateParts(now.getFullYear(), monthDay[1], monthDay[2]);
    return localDateString();
  }

  function normalizeDateParts(year, month, day) {
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isNaN(date.getTime())) return localDateString();
    return localDateString(date);
  }

  function findLearnedRule(type, text) {
    const normalized = normalizeMerchant(text);
    if (!normalized) return null;
    return [...state.rules]
      .filter((rule) => rule.type === type && normalized.includes(rule.normalizedMerchant))
      .sort((a, b) => b.normalizedMerchant.length - a.normalizedMerchant.length)[0] || null;
  }

  function classifyText(type, text) {
    const value = String(text || "").toLowerCase();
    const candidates = [];

    getAllPrimary(type).forEach((primary) => {
      if (!primary.active) return;
      primary.children.forEach((secondary) => {
        if (!secondary.active) return;
        const keywords = [...(primary.keywords || []), ...(secondary.keywords || []), secondary.name];
        keywords.forEach((keyword) => {
          if (keyword && value.includes(String(keyword).toLowerCase())) {
            candidates.push({
              primary,
              secondary,
              score: String(keyword).length * ((secondary.keywords || []).includes(keyword) ? 12 : 10)
            });
          }
        });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function extractMerchant(text) {
    let merchant = removeDateExpressions(text)
      .replace(/[¥￥]?\s*\d+(?:\.\d{1,2})?\s*(?:元|块钱?|人民币|rmb)?/gi, " ")
      .replace(/微信支付|支付宝|银行卡|信用卡|现金/g, " ")
      .replace(/付款|支付|消费|花了|买了|收入|到账|收到|共计|金额/gi, " ")
      .replace(/[，,。.!！?？:：;；]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return merchant.slice(0, 40);
  }

  function parseSmartInput(input) {
    const raw = String(input || "").trim();
    const type = detectType(raw);
    const amount = detectAmount(raw);
    const date = detectDate(raw);
    const method = paymentMethodFromText(raw);
    const merchant = extractMerchant(raw);
    const learnedRule = findLearnedRule(type, raw);
    let primary = null;
    let secondary = null;
    let source = "keyword";

    if (learnedRule) {
      primary = findPrimary(type, learnedRule.primaryCategoryId);
      secondary = primary?.children.find((child) => child.id === learnedRule.secondaryCategoryId);
      if (primary && secondary) source = "learned";
    }

    if (!primary || !secondary) {
      const classified = classifyText(type, raw);
      if (classified) {
        primary = classified.primary;
        secondary = classified.secondary;
      }
    }

    if (!primary || !secondary) {
      primary = getAllPrimary(type).find((category) => category.name === "其他") || getAllPrimary(type)[0] || null;
      secondary = primary?.children.find((child) => child.active) || primary?.children[0] || null;
      source = "fallback";
    }

    return {
      input: raw,
      type,
      amount,
      date,
      method,
      merchant: merchant || secondary?.name || "",
      primaryCategoryId: primary?.id || "",
      secondaryCategoryId: secondary?.id || "",
      primary,
      secondary,
      source
    };
  }

  function renderSmartDetection() {
    const container = $("#detection");
    const editButton = $("#smart-edit");
    const input = $("#smart-input").value.trim();
    if (!input) {
      smartDraft = null;
      container.innerHTML = `<span class="detection-placeholder">${iconUse("spark")}输入后，这里会显示自动识别结果</span>`;
      editButton.hidden = true;
      return;
    }

    smartDraft = parseSmartInput(input);
    const tags = [`<span class="detection-tag">${smartDraft.type === "income" ? "收入" : "支出"}</span>`];
    if (smartDraft.amount > 0) {
      tags.push(`<span class="detection-tag amount">${formatMoney(smartDraft.amount)}</span>`);
    } else {
      tags.push(`<span class="detection-tag warn">还需要填写金额</span>`);
    }
    tags.push(`<span class="detection-tag">${escapeHtml(monthDayLabel(smartDraft.date))}</span>`);
    if (smartDraft.primary && smartDraft.secondary) {
      tags.push(`<span class="detection-tag">${escapeHtml(smartDraft.primary.name)} / ${escapeHtml(smartDraft.secondary.name)}</span>`);
    } else {
      tags.push(`<span class="detection-tag warn">分类待确认</span>`);
    }
    if (smartDraft.method !== "其他") {
      tags.push(`<span class="detection-tag">${escapeHtml(smartDraft.method)}</span>`);
    }
    if (smartDraft.source === "learned") {
      tags.push(`<span class="detection-tag">已记住</span>`);
    }
    container.innerHTML = `<div class="detection-tags">${tags.join("")}</div>`;
    editButton.hidden = false;
  }

  function monthDayLabel(dateString) {
    const date = parseLocalDate(dateString);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function setView(view) {
    if (!PAGE_META[view]) return;
    activeView = view;
    $$(".view").forEach((section) => section.classList.toggle("active", section.dataset.page === view));
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    const [title, subtitle] = PAGE_META[view];
    $("#page-title").textContent = title;
    $("#page-subtitle").textContent = subtitle;
    $("#month-control").hidden = !["overview", "ledger", "budget"].includes(view);
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderAll() {
    $("#month-label").textContent = selectedMonth === currentMonthKey() ? `本月 · ${Number(selectedMonth.slice(5))}月` : monthLabel(selectedMonth);
    $("#demo-banner").hidden = !state.demo;
    renderDashboard();
    renderLedgerFilters();
    renderLedger();
    renderCategories();
    renderBudget();
    renderDataTools();
  }

  function renderDashboard() {
    const transactions = getMonthTransactions();
    const currentSummary = summarizeTransactions(transactions);
    const previousTransactions = getMonthTransactions(previousMonthKey(selectedMonth));
    const previousSummary = summarizeTransactions(previousTransactions);
    const balance = currentSummary.income - currentSummary.expense;
    const budget = getBudget(selectedMonth);
    const budgetPercent = budget.total > 0 ? (currentSummary.expense / budget.total) * 100 : 0;
    const expenseCount = transactions.filter((tx) => tx.type === "expense").length;
    const incomeCount = transactions.filter((tx) => tx.type === "income").length;

    $("#metric-expense").textContent = formatMoney(currentSummary.expense);
    $("#metric-income").textContent = formatMoney(currentSummary.income);
    $("#metric-balance").textContent = formatMoney(balance);
    $("#metric-budget").textContent = budget.total > 0 ? `${Math.round(budgetPercent)}%` : "未设置";
    $("#metric-expense-foot").textContent = expenseTrendCopy(currentSummary.expense, previousSummary.expense, expenseCount);
    $("#metric-income-foot").textContent = previousSummary.income > 0
      ? compareCopy(currentSummary.income, previousSummary.income, "较上月")
      : `${incomeCount} 笔收入`;
    $("#metric-balance-foot").textContent = currentSummary.income > 0
      ? `储蓄率 ${Math.max(0, Math.round((balance / currentSummary.income) * 100))}%`
      : (balance < 0 ? "本月支出超过收入" : "收支平衡");
    $("#metric-budget-foot").textContent = budget.total > 0
      ? `剩余 ${formatCompactMoney(Math.max(0, budget.total - currentSummary.expense))}`
      : "前往预算页设置";

    renderTrendChart(transactions);
    renderDonut(transactions);
    renderInsight(transactions, currentSummary, budget);
  }

  function expenseTrendCopy(current, previous, count) {
    if (previous > 0) return compareCopy(current, previous, `较上月 · ${count}笔`);
    return count > 0 ? `本月已记录 ${count} 笔支出` : "暂无支出";
  }

  function compareCopy(current, previous, suffix) {
    if (!previous) return suffix;
    const delta = Math.round(((current - previous) / previous) * 100);
    if (delta === 0) return `${suffix}持平`;
    return `${suffix}${delta > 0 ? "增加" : "减少"} ${Math.abs(delta)}%`;
  }

  function renderTrendChart(transactions) {
    const svg = $("#trend-chart");
    const total = transactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
    $("#trend-total").textContent = formatCompactMoney(total);
    const days = daysInMonth(selectedMonth);
    const daily = Array.from({ length: days }, (_, index) => ({
      day: index + 1,
      amount: 0
    }));
    transactions.filter((tx) => tx.type === "expense").forEach((tx) => {
      const day = Number(tx.date.slice(8, 10));
      if (daily[day - 1]) daily[day - 1].amount += tx.amount;
    });
    const maxValue = Math.max(...daily.map((item) => item.amount), 1);
    const axisMax = niceAxisMax(maxValue);
    const width = 760;
    const height = 240;
    const left = 46;
    const right = 20;
    const top = 18;
    const bottom = 38;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const points = daily.map((item, index) => ({
      ...item,
      x: left + (index / Math.max(1, daily.length - 1)) * innerW,
      y: top + innerH - (item.amount / axisMax) * innerH
    }));
    const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const area = `${left},${top + innerH} ${line} ${left + innerW},${top + innerH}`;
    const grid = [0, 0.5, 1].map((ratio) => {
      const y = top + innerH - ratio * innerH;
      const value = axisMax * ratio;
      return `<line class="grid-line" x1="${left}" y1="${y}" x2="${left + innerW}" y2="${y}"></line>
        <text x="4" y="${y + 3}">${value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k` : Math.round(value)}</text>`;
    }).join("");
    const labelDays = [...new Set([1, Math.ceil(days / 4), Math.ceil(days / 2), Math.ceil(days * 0.75), days])];
    const labels = labelDays.map((day) => {
      const x = left + ((day - 1) / Math.max(1, days - 1)) * innerW;
      return `<text text-anchor="middle" x="${x}" y="${height - 10}">${day}日</text>`;
    }).join("");
    const dots = points.filter((point) => point.amount > 0).slice(-6).map((point) => {
      const label = point.amount >= 1000 ? `¥${(point.amount / 1000).toFixed(1)}k` : `¥${Math.round(point.amount)}`;
      const selectedPoint = point.amount === maxValue;
      return `<g>
        <circle class="dot" cx="${point.x}" cy="${point.y}" r="${selectedPoint ? 4 : 3}"></circle>
        ${selectedPoint ? `<rect x="${Math.min(point.x - 24, width - 55)}" y="${Math.max(1, point.y - 28)}" width="48" height="19" rx="6" fill="#34363a"></rect><text fill="#fff" text-anchor="middle" x="${Math.min(point.x + 0, width - 31)}" y="${Math.max(14, point.y - 15)}">${label}</text>` : ""}
      </g>`;
    }).join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f8ccdb" stop-opacity=".82"></stop>
          <stop offset="100%" stop-color="#f8ccdb" stop-opacity=".04"></stop>
        </linearGradient>
      </defs>
      ${grid}
      <polygon class="area" points="${area}"></polygon>
      <polyline class="line" points="${line}"></polyline>
      ${dots}
      ${labels}
    `;
  }

  function niceAxisMax(value) {
    if (value <= 100) return Math.ceil(value / 20) * 20;
    if (value <= 1000) return Math.ceil(value / 100) * 100;
    if (value <= 10000) return Math.ceil(value / 1000) * 1000;
    return Math.ceil(value / 5000) * 5000;
  }

  function renderDonut(transactions) {
    const categories = expenseByPrimary(transactions);
    const total = categories.reduce((sum, category) => sum + category.amount, 0);
    const donut = $("#category-donut");
    $("#donut-total").textContent = formatCompactMoney(total);

    if (!categories.length) {
      donut.style.background = "conic-gradient(#dfe3e2 0 100%)";
      $("#category-legend").innerHTML = `<div class="empty-list"><div><p>还没有支出数据</p></div></div>`;
      return;
    }

    const top = categories.slice(0, 5);
    const rest = categories.slice(5).reduce((sum, category) => sum + category.amount, 0);
    const display = rest > 0 ? [...top, { id: "rest", name: "其他分类", amount: rest }] : top;
    let cursor = 0;
    const segments = display.map((category, index) => {
      const percent = total > 0 ? (category.amount / total) * 100 : 0;
      const segment = `${CATEGORY_COLORS[index % CATEGORY_COLORS.length]} ${cursor}% ${cursor + percent}%`;
      cursor += percent;
      return segment;
    });
    donut.style.background = `conic-gradient(${segments.join(", ")})`;
    $("#category-legend").innerHTML = display.map((category, index) => `
      <div class="legend-row">
        <i style="background:${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}"></i>
        <span>${escapeHtml(category.name)}</span>
        <strong>${total ? Math.round((category.amount / total) * 100) : 0}%</strong>
      </div>
    `).join("");
  }

  function renderInsight(transactions, summary, budget) {
    const categories = expenseByPrimary(transactions);
    if (!transactions.length) {
      $("#insight-title").textContent = "你的账本正在变清晰";
      $("#insight-copy").textContent = "再记几笔，我会告诉你钱都花在了哪里。";
    } else if (categories.length) {
      const largest = categories[0];
      const percent = summary.expense > 0 ? Math.round((largest.amount / summary.expense) * 100) : 0;
      $("#insight-title").textContent = `${largest.name}是用得最多的一类`;
      $("#insight-copy").textContent = `本月 ${largest.name}共 ${formatMoney(largest.amount)}，占总支出的 ${percent}%。${percent > 45 ? "可以留意一下这类消费。" : "整体分配还算均衡。"}`;
    }

    const percent = budget.total > 0 ? Math.min((summary.expense / budget.total) * 100, 100) : 0;
    $("#budget-mini-value").textContent = budget.total > 0 ? formatCompactMoney(budget.total) : "未设置";
    $("#budget-mini-progress").style.width = `${percent}%`;
    $("#budget-mini-progress").parentElement.className = `progress ${percent >= 100 ? "danger" : percent >= 80 ? "warning" : ""}`;
    $("#budget-mini-label").textContent = budget.total > 0
      ? (summary.expense > budget.total ? `已超出 ${formatCompactMoney(summary.expense - budget.total)}` : `已用 ${Math.round(percent)}%，还剩 ${formatCompactMoney(budget.total - summary.expense)}`)
      : "设置预算，消费更有数";
  }

  function sortTransactions(transactions) {
    return [...transactions].sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      return byDate || String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function renderLedgerFilters() {
    const categorySelect = $("#ledger-category");
    const previousValue = categorySelect.value || "all";
    const categories = [...state.categories.expense, ...state.categories.income];
    categorySelect.innerHTML = `<option value="all">全部分类</option>${categories.map((category) => `
      <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
    `).join("")}`;
    categorySelect.value = categories.some((category) => category.id === previousValue) ? previousValue : "all";

    const methodSelect = $("#ledger-method");
    const previousMethod = methodSelect.value || "all";
    const methods = [...new Set([...METHODS, ...state.transactions.map((tx) => tx.method)])];
    methodSelect.innerHTML = `<option value="all">全部方式</option>${methods.map((method) => `
      <option value="${escapeHtml(method)}">${escapeHtml(method)}</option>
    `).join("")}`;
    methodSelect.value = methods.includes(previousMethod) ? previousMethod : "all";
  }

  function getFilteredTransactions() {
    const type = $("#ledger-type").value;
    const categoryId = $("#ledger-category").value;
    const method = $("#ledger-method").value;
    const search = $("#ledger-search").value.trim().toLowerCase();
    return sortTransactions(getMonthTransactions()).filter((tx) => {
      const { primary, secondary } = resolveCategory(tx);
      if (type !== "all" && tx.type !== type) return false;
      if (categoryId !== "all" && primary.id !== categoryId) return false;
      if (method !== "all" && tx.method !== method) return false;
      if (search) {
        const haystack = [tx.merchant, tx.note, tx.amount, primary.name, secondary.name, tx.method]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function renderLedger() {
    const monthTransactions = getMonthTransactions();
    const summary = summarizeTransactions(monthTransactions);
    $("#ledger-summary").innerHTML = `
      <span><i class="income-dot"></i>收入 <strong>${formatCompactMoney(summary.income)}</strong></span>
      <span><i class="expense-dot"></i>支出 <strong>${formatCompactMoney(summary.expense)}</strong></span>
    `;
    const transactions = getFilteredTransactions();
    const body = $("#ledger-body");
    const empty = $("#ledger-empty");
    if (!transactions.length) {
      body.innerHTML = "";
      empty.hidden = false;
      $("#ledger-footer").innerHTML = `<span>${monthLabel(selectedMonth)}</span><span>0 笔流水</span>`;
      return;
    }
    empty.hidden = true;
    body.innerHTML = transactions.map((tx) => {
      const { primary, secondary } = resolveCategory(tx);
      const date = parseLocalDate(tx.date);
      return `
        <tr>
          <td><span class="date-cell"><strong>${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}</strong><span>${WEEKDAYS[date.getDay()]}</span></span></td>
          <td><span class="category-cell"><i>${escapeHtml(primary.icon)}</i><span>${escapeHtml(secondary.name)}<small>${escapeHtml(primary.name)}</small></span></span></td>
          <td><span class="merchant-cell" title="${escapeHtml(tx.note || tx.merchant)}">${escapeHtml(tx.merchant || secondary.name)}</span></td>
          <td><span class="method-badge">${escapeHtml(tx.method)}</span></td>
          <td class="amount-cell ${tx.type === "income" ? "income" : ""}">${tx.type === "income" ? "+" : "-"}${formatMoney(tx.amount)}</td>
          <td><span class="row-actions">
            <button class="row-action" type="button" data-edit-tx="${escapeHtml(tx.id)}" aria-label="编辑流水">${iconUse("edit")}</button>
            <button class="row-action delete" type="button" data-delete-tx="${escapeHtml(tx.id)}" aria-label="删除流水">${iconUse("trash")}</button>
          </span></td>
        </tr>
      `;
    }).join("");
    const filteredSummary = summarizeTransactions(transactions);
    $("#ledger-footer").innerHTML = `<span>${monthLabel(selectedMonth)} · ${transactions.length} 笔</span><span>筛选收入 ${formatCompactMoney(filteredSummary.income)} / 支出 ${formatCompactMoney(filteredSummary.expense)}</span>`;
  }

  function renderCategories() {
    renderCategoryManager("expense");
    renderCategoryManager("income");
  }

  function renderCategoryManager(type) {
    const manager = $(`#${type}-category-manager`);
    const isExpense = type === "expense";
    const categories = getAllPrimary(type);
    const childrenCount = categories.reduce((sum, category) => sum + category.children.length, 0);
    manager.innerHTML = `
      <div class="manager-head">
        <div class="manager-title">
          <span>${iconUse(isExpense ? "arrow-up-right" : "arrow-down-left")}</span>
          <div><h3>${isExpense ? "支出分类" : "收入分类"}</h3><small>${categories.length} 个一级分类 · ${childrenCount} 个二级分类</small></div>
        </div>
        <button class="manager-add" type="button" data-add-primary="${type}">${iconUse("plus")} 新增一级</button>
      </div>
      ${categories.length ? categories.map((primary) => `
        <div class="primary-category">
          <div class="primary-category-head">
            <span class="primary-category-name"><i></i>${escapeHtml(primary.icon)} ${escapeHtml(primary.name)} <small class="category-count">${primary.children.length}</small></span>
            <span class="category-actions">
              <button type="button" data-add-child="${escapeHtml(primary.id)}" data-category-type="${type}">+ 二级</button>
              <button type="button" data-edit-category="${escapeHtml(primary.id)}" data-category-type="${type}" data-category-level="primary">改名</button>
            </span>
          </div>
          <div class="child-categories">
            ${primary.children.length ? primary.children.map((child) => `
              <span class="child-category ${child.active ? "" : "inactive"}">
                <button type="button" data-edit-category="${escapeHtml(child.id)}" data-category-type="${type}" data-category-level="child" data-parent-id="${escapeHtml(primary.id)}" title="编辑 ${escapeHtml(child.name)}">${escapeHtml(child.name)}</button>
                <button type="button" data-edit-category="${escapeHtml(child.id)}" data-category-type="${type}" data-category-level="child" data-parent-id="${escapeHtml(primary.id)}" aria-label="编辑分类">${iconUse("more")}</button>
              </span>
            `).join("") : `<span class="child-empty">暂无二级分类，点击右上角“+ 二级”添加</span>`}
          </div>
        </div>
      `).join("") : `<div class="manager-empty">还没有分类，先新增一个吧。</div>`}
    `;
  }

  function openCategoryModal(config) {
    const { mode, type, primary = null, secondary = null } = config;
    $("#category-mode").value = mode;
    $("#category-type").value = type;
    $("#category-id").value = mode.endsWith("primary") ? (primary?.id || "") : (secondary?.id || "");
    $("#category-parent-id").value = primary?.id || "";
    $("#category-parent-name").value = primary?.name || "";
    $("#category-child-name").value = secondary?.name || "";
    $("#category-active").checked = (secondary || primary)?.active !== false;
    $("#category-child-field").hidden = mode !== "add-primary" && mode !== "add-child" && mode !== "edit-child";
    $("#category-child-optional").textContent = mode === "add-primary" ? "选填" : "必填";
    $("#category-active-field").hidden = mode === "add-primary" || mode === "add-child";
    $("#category-type-badge").textContent = type === "expense" ? "支出分类" : "收入分类";
    $("#category-type-badge").classList.toggle("income", type === "income");
    $("#category-parent-name").readOnly = mode === "add-child" || mode === "edit-child";
    $("#category-modal-title").textContent = mode === "add-primary" ? "新增一级分类" : mode === "edit-primary" ? "编辑一级分类" : mode === "add-child" ? "新增二级分类" : "编辑二级分类";
    $("#category-modal-kicker").textContent = mode.includes("primary") ? "PRIMARY CATEGORY" : "SUBCATEGORY";
    openModal("category-modal");
    setTimeout(() => {
      if (mode === "add-primary") $("#category-parent-name").focus();
      else if (mode === "add-child") $("#category-child-name").focus();
      else $("input:not([type=hidden]):not([readonly])", $("#category-form"))?.focus();
    }, 50);
  }

  function handleCategorySubmit(event) {
    event.preventDefault();
    const mode = $("#category-mode").value;
    const type = $("#category-type").value;
    const id = $("#category-id").value;
    const parentId = $("#category-parent-id").value;
    const parentName = $("#category-parent-name").value.trim();
    const childName = $("#category-child-name").value.trim();
    if (!parentName) return showToast("请填写一级分类名称。", "error");
    if ((mode === "add-child" || mode === "edit-child") && !childName) return showToast("请填写二级分类名称。", "error");

    if (mode === "add-primary") {
      if (getAllPrimary(type).some((category) => category.name === parentName)) return showToast("这个一级分类已经存在。", "error");
      const primary = {
        id: uid(type === "expense" ? "epy" : "ipy"),
        name: parentName,
        icon: type === "expense" ? "✨" : "💰",
        keywords: [parentName],
        active: true,
        children: childName ? [{ id: uid("sub"), name: childName, keywords: [childName], active: true }] : []
      };
      state.categories[type].push(primary);
    } else if (mode === "edit-primary") {
      const primary = findPrimary(type, id);
      if (!primary) return;
      primary.name = parentName;
      primary.active = $("#category-active").checked;
    } else if (mode === "add-child") {
      const primary = findPrimary(type, parentId);
      if (!primary) return;
      if (primary.children.some((child) => child.name === childName)) return showToast("这个二级分类已经存在。", "error");
      primary.children.push({ id: uid("sub"), name: childName, keywords: [childName], active: true });
    } else if (mode === "edit-child") {
      const primary = findPrimary(type, parentId);
      const child = primary?.children.find((item) => item.id === id);
      if (!primary || !child) return;
      if (primary.children.some((item) => item.id !== child.id && item.name === childName)) return showToast("这个二级分类已经存在。", "error");
      child.name = childName;
      child.active = $("#category-active").checked;
      primary.active = primary.active || child.active;
    }

    saveState();
    closeModal("category-modal");
    renderAll();
    showToast("分类已保存。");
  }

  function getBudget(month) {
    const budget = state.budgets[month];
    return {
      total: Math.max(0, Number(budget?.total) || 0),
      categories: budget?.categories && typeof budget.categories === "object" ? budget.categories : {}
    };
  }

  function renderBudget() {
    const monthTransactions = getMonthTransactions();
    const summary = summarizeTransactions(monthTransactions);
    const budget = getBudget(selectedMonth);
    const percent = budget.total > 0 ? (summary.expense / budget.total) * 100 : 0;
    const displayPercent = Math.min(percent, 100);

    $("#total-budget-input").value = budget.total || "";
    $("#budget-ring").style.background = `conic-gradient(${percent >= 100 ? "#b45d75" : percent >= 80 ? "#a17c60" : "var(--forest)"} 0 ${displayPercent}%, #dfe3e2 ${displayPercent}% 100%)`;
    $("#budget-ring-percent").textContent = `${Math.round(percent)}%`;
    $("#budget-spent").textContent = formatMoney(summary.expense);
    $("#budget-left").textContent = formatMoney(Math.max(0, budget.total - summary.expense));

    if (!budget.total) {
      $("#budget-status-title").textContent = "预算尚未设置";
      $("#budget-status-copy").textContent = "设置总预算后，这里会显示本月使用进度。";
      $("#budget-tip-title").textContent = "先从小目标开始";
      $("#budget-tip-copy").textContent = "建议把总预算拆到几个主要分类，比只看余额更容易坚持。";
    } else if (summary.expense > budget.total) {
      $("#budget-status-title").textContent = "本月预算已超出";
      $("#budget-status-copy").textContent = `目前超出 ${formatMoney(summary.expense - budget.total)}，可以检查一下高支出分类。`;
      $("#budget-tip-title").textContent = "把注意力放回分类";
      $("#budget-tip-copy").textContent = "总预算只是边界，分类预算能帮你更快找到超支来源。";
    } else if (percent >= 80) {
      $("#budget-status-title").textContent = "接近预算上限";
      $("#budget-status-copy").textContent = `本月已经使用 ${Math.round(percent)}%，剩余 ${formatMoney(budget.total - summary.expense)}。`;
      $("#budget-tip-title").textContent = "留一点弹性";
      $("#budget-tip-copy").textContent = "接下来的支出优先选择真正必要的项目，月底会更轻松。";
    } else {
      $("#budget-status-title").textContent = "预算节奏良好";
      $("#budget-status-copy").textContent = `本月已经使用 ${Math.round(percent)}%，还剩 ${formatMoney(budget.total - summary.expense)}。`;
      $("#budget-tip-title").textContent = "继续按自己的节奏";
      $("#budget-tip-copy").textContent = "预算不是为了限制生活，而是让重要的事情有足够空间。";
    }

    const expenseByCategoryMap = new Map(expenseByPrimary(monthTransactions).map((category) => [category.id, category.amount]));
    $("#category-budget-list").innerHTML = state.categories.expense.map((primary) => {
      const categoryBudget = Math.max(0, Number(budget.categories[primary.id]) || 0);
      const spent = expenseByCategoryMap.get(primary.id) || 0;
      const categoryPercent = categoryBudget > 0 ? (spent / categoryBudget) * 100 : 0;
      const progressClass = categoryPercent >= 100 ? "danger" : categoryPercent >= 80 ? "warning" : "";
      return `
        <div class="category-budget-row">
          <div class="budget-category-name">
            <i>${escapeHtml(primary.icon)}</i>
            <span>${escapeHtml(primary.name)}<small>已用 ${formatCompactMoney(spent)}</small></span>
          </div>
          <div class="budget-category-progress">
            <div class="progress ${progressClass}"><span style="width:${Math.min(categoryPercent, 100)}%"></span></div>
            <small>${categoryBudget > 0 ? `预算 ${formatCompactMoney(categoryBudget)}` : "尚未设置分类预算"}</small>
          </div>
          <label class="mini-money-input"><span>¥</span><input type="number" min="0" step="50" value="${categoryBudget || ""}" placeholder="0" data-category-budget="${escapeHtml(primary.id)}" aria-label="${escapeHtml(primary.name)}预算"></label>
          <span class="budget-row-percent ${categoryPercent >= 100 ? "over" : ""}">${categoryBudget ? `${Math.round(categoryPercent)}%` : "—"}</span>
        </div>
      `;
    }).join("");
  }

  function saveTotalBudget() {
    const amount = Math.max(0, Number($("#total-budget-input").value) || 0);
    if (!state.budgets[selectedMonth]) state.budgets[selectedMonth] = { total: 0, categories: {} };
    state.budgets[selectedMonth].total = amount;
    saveState();
    renderAll();
    showToast(amount ? `${monthLabel(selectedMonth)}预算已保存。` : "总预算已清除。");
  }

  function saveCategoryBudget(input) {
    const amount = Math.max(0, Number(input.value) || 0);
    if (!state.budgets[selectedMonth]) state.budgets[selectedMonth] = { total: 0, categories: {} };
    if (!state.budgets[selectedMonth].categories) state.budgets[selectedMonth].categories = {};
    if (amount) state.budgets[selectedMonth].categories[input.dataset.categoryBudget] = amount;
    else delete state.budgets[selectedMonth].categories[input.dataset.categoryBudget];
    saveState();
    renderBudget();
    renderDashboard();
  }

  function renderDataTools() {
    const bytes = new Blob([JSON.stringify(state)]).size;
    $("#storage-size").textContent = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    $("#rule-count").textContent = state.rules.length;
    const list = $("#rule-list");
    if (!state.rules.length) {
      list.innerHTML = `<div class="rule-empty">还没有学习规则。修改一笔自动分类后，它会出现在这里。</div>`;
    } else {
      list.innerHTML = state.rules.slice(0, 8).map((rule) => {
        const primary = findPrimary(rule.type, rule.primaryCategoryId);
        const secondary = findSecondary(rule.type, rule.primaryCategoryId, rule.secondaryCategoryId);
        return `
          <div class="rule-row">
            <strong title="${escapeHtml(rule.merchant)}">${escapeHtml(rule.merchant)}</strong>
            <span class="rule-arrow">→</span>
            <span class="rule-destination">${escapeHtml(primary?.name || "未分类")} / ${escapeHtml(secondary?.name || "未分类")}</span>
            <button class="row-action delete" type="button" data-delete-rule="${escapeHtml(rule.id)}" aria-label="删除规则">${iconUse("x")}</button>
          </div>
        `;
      }).join("");
    }
    $("#danger-copy").textContent = state.demo
      ? "删除当前浏览器中的示例与真实流水、预算和自动分类规则。"
      : "删除当前浏览器中的全部流水、预算和自动分类规则。";
  }

  function openTransactionModal(source = null) {
    lastFocusedElement = document.activeElement;
    $("#transaction-form").reset();
    $("#transaction-id").value = source?.id || "";
    const type = source?.type || "expense";
    $(`input[name="transaction-type"][value="${type}"]`).checked = true;
    $("#transaction-amount").value = source?.amount || "";
    $("#transaction-date").value = source?.date || localDateString();
    $("#transaction-method").value = METHODS.includes(source?.method) ? source.method : "其他";
    $("#transaction-merchant").value = source?.merchant || "";
    $("#transaction-note").value = source?.note || "";
    $("#transaction-modal-title").textContent = source?.id ? "编辑流水" : "记一笔";
    populateTransactionCategories(
      type,
      source?.primaryCategoryId || null,
      source?.secondaryCategoryId || null
    );
    openModal("transaction-modal");
    setTimeout(() => $("#transaction-amount").focus(), 50);
  }

  function populateTransactionCategories(type, primaryId = null, secondaryId = null) {
    const primarySelect = $("#transaction-primary");
    const categories = getAllPrimary(type).filter((primary) => primary.active || primary.id === primaryId);
    let selectedPrimary = categories.find((primary) => primary.id === primaryId);
    if (!selectedPrimary) selectedPrimary = categories.find((primary) => primary.children.some((child) => child.active)) || categories[0];
    primarySelect.innerHTML = categories.map((primary) => {
      const hasAvailableChild = primary.children.some((child) => child.active) || primary.id === primaryId;
      return `<option value="${escapeHtml(primary.id)}" ${hasAvailableChild ? "" : "disabled"}>${escapeHtml(primary.name)}</option>`;
    }).join("");
    if (selectedPrimary) primarySelect.value = selectedPrimary.id;
    populateSecondaryCategories(type, primarySelect.value, secondaryId);
  }

  function populateSecondaryCategories(type, primaryId, secondaryId = null) {
    const primary = findPrimary(type, primaryId);
    const secondarySelect = $("#transaction-secondary");
    const children = (primary?.children || []).filter((child) => child.active || child.id === secondaryId);
    if (!children.length) {
      secondarySelect.innerHTML = `<option value="">请先添加二级分类</option>`;
      return;
    }
    secondarySelect.innerHTML = children.map((child) => `<option value="${escapeHtml(child.id)}">${escapeHtml(child.name)}</option>`).join("");
    if (children.some((child) => child.id === secondaryId)) secondarySelect.value = secondaryId;
  }

  function handleTransactionTypeChange(type) {
    populateTransactionCategories(type);
  }

  function handleTransactionSubmit(event) {
    event.preventDefault();
    const id = $("#transaction-id").value;
    const type = $('input[name="transaction-type"]:checked').value;
    const amount = Number($("#transaction-amount").value);
    const date = $("#transaction-date").value;
    const primaryCategoryId = $("#transaction-primary").value;
    const secondaryCategoryId = $("#transaction-secondary").value;
    if (!Number.isFinite(amount) || amount <= 0) return showToast("请输入大于 0 的金额。", "error");
    if (!date) return showToast("请选择日期。", "error");
    if (!primaryCategoryId || !secondaryCategoryId) return showToast("请选择完整的一级和二级分类。", "error");

    const existingIndex = state.transactions.findIndex((tx) => tx.id === id);
    const previous = existingIndex >= 0 ? state.transactions[existingIndex] : null;
    if (state.demo && !previous) {
      clearDemoTransactions(false);
    }
    const tx = {
      id: id || uid("tx"),
      type,
      amount: Math.round(amount * 100) / 100,
      primaryCategoryId,
      secondaryCategoryId,
      merchant: $("#transaction-merchant").value.trim(),
      note: $("#transaction-note").value.trim(),
      method: $("#transaction-method").value,
      date,
      createdAt: previous?.createdAt || new Date().toISOString()
    };
    if (existingIndex >= 0) state.transactions[existingIndex] = tx;
    else state.transactions.push(tx);

    if (tx.merchant) learnRule(tx);
    saveState();
    closeModal("transaction-modal");
    renderAll();
    showToast(previous ? "这笔流水已更新。" : "已记好这一笔。");
  }

  function submitSmartTransaction() {
    const input = $("#smart-input").value.trim();
    if (!input) return showToast("先输入一句话，再说说这笔账。", "error");
    const draft = parseSmartInput(input);
    if (!draft.amount || draft.amount <= 0) return showToast("没有识别到金额，可以点击“调整”手动填写。", "error");
    if (!draft.primaryCategoryId || !draft.secondaryCategoryId) {
      openTransactionModal(draft);
      return showToast("请确认这笔账的分类。");
    }
    if (state.demo) clearDemoTransactions(false);
    const tx = {
      id: uid("tx"),
      type: draft.type,
      amount: Math.round(draft.amount * 100) / 100,
      primaryCategoryId: draft.primaryCategoryId,
      secondaryCategoryId: draft.secondaryCategoryId,
      merchant: draft.merchant,
      note: draft.input,
      method: draft.method,
      date: draft.date,
      createdAt: new Date().toISOString()
    };
    if (tx.merchant) learnRule(tx);
    state.transactions.push(tx);
    saveState();
    $("#smart-input").value = "";
    renderSmartDetection();
    renderAll();
    showToast(`已记好：${draft.primary.name} / ${draft.secondary.name} ${formatMoney(draft.amount)}`);
  }

  function learnRule(tx) {
    const normalized = normalizeMerchant(tx.merchant);
    if (!normalized) return;
    const existing = state.rules.find((rule) => rule.type === tx.type && rule.normalizedMerchant === normalized);
    if (existing) {
      existing.merchant = tx.merchant;
      existing.primaryCategoryId = tx.primaryCategoryId;
      existing.secondaryCategoryId = tx.secondaryCategoryId;
    } else {
      state.rules.unshift({
        id: uid("rule"),
        merchant: tx.merchant,
        normalizedMerchant: normalized,
        type: tx.type,
        primaryCategoryId: tx.primaryCategoryId,
        secondaryCategoryId: tx.secondaryCategoryId
      });
      state.rules = state.rules.slice(0, 100);
    }
    dedupeRules();
  }

  function dedupeRules(target = state) {
    const seen = new Set();
    target.rules = target.rules.filter((rule) => {
      const key = `${rule.type}|${rule.normalizedMerchant || normalizeMerchant(rule.merchant)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function deleteTransaction(id) {
    const tx = state.transactions.find((item) => item.id === id);
    if (!tx) return;
    const { primary, secondary } = resolveCategory(tx);
    if (!window.confirm(`确定删除“${tx.merchant || `${primary.name}/${secondary.name}`}”这笔 ${formatMoney(tx.amount)} 的流水吗？`)) return;
    state.transactions = state.transactions.filter((item) => item.id !== id);
    saveState();
    renderAll();
    showToast("流水已删除。");
  }

  function clearDemoTransactions(notify = true) {
    if (!state.demo) return;
    state.transactions = [];
    state.budgets = {};
    state.rules = [];
    state.demo = false;
    saveState();
    if (notify) {
      renderAll();
      showToast("示例数据已清空，现在开始记录你的账本。");
    }
  }

  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $("#voice-button").addEventListener("click", () => showToast("当前浏览器不支持语音识别，请输入文字记账。", "error"));
      return;
    }
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = "zh-CN";
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;
    speechRecognition.onstart = () => {
      voiceListening = true;
      $("#voice-button").classList.add("listening");
      $("#voice-button span").textContent = "正在听…";
    };
    speechRecognition.onend = () => {
      voiceListening = false;
      $("#voice-button").classList.remove("listening");
      $("#voice-button span").textContent = "语音记账";
    };
    speechRecognition.onerror = (event) => {
      if (event.error !== "aborted") showToast("没有听清，请再试一次或直接输入文字。", "error");
    };
    speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      $("#smart-input").value = transcript.replace(/[。]$/, "");
      renderSmartDetection();
      showToast(`听到：${$("#smart-input").value}`);
    };
    $("#voice-button").addEventListener("click", () => {
      if (voiceListening) {
        speechRecognition.stop();
        return;
      }
      try {
        speechRecognition.start();
      } catch {
        showToast("语音识别暂时不可用。", "error");
      }
    });
  }

  async function readCsvFile(file) {
    const buffer = await file.arrayBuffer();
    let text;
    let encoding = "UTF-8";
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder("gb18030").decode(buffer);
      encoding = "GB18030";
    }
    text = text.replace(/^\uFEFF/, "");
    const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
    const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
    const rows = parseCsv(text, delimiter).filter((row) => row.some((cell) => cell.trim()));
    if (rows.length < 2) throw new Error("CSV 中没有可导入的数据");
    const headers = rows[0].map((header, index) => header.trim() || `第 ${index + 1} 列`);
    const mapping = {};
    MAPPING_FIELDS.forEach((field) => {
      mapping[field.key] = guessColumn(headers, field.key);
    });
    importSession = { fileName: file.name, encoding, headers, rows: rows.slice(1), mapping };
    renderMappingPanel();
  }

  function parseCsv(text, delimiter = ",") {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"') {
        if (quoted && next === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function guessColumn(headers, key) {
    const aliases = {
      date: ["日期", "交易日期", "交易时间", "时间", "date", "记账日期"],
      type: ["收支类型", "类型", "交易类型", "收入支出", "收/支", "借贷标志", "type"],
      amount: ["金额", "交易金额", "金额(元)", "金额（元）", "amount", "收支金额"],
      merchant: ["商户", "交易对方", "对方", "商户名称", "merchant", "收款方", "付款方"],
      primary: ["一级分类", "分类", "类别", "category", "交易分类"],
      secondary: ["二级分类", "子分类", "subcategory"],
      note: ["备注", "商品", "商品说明", "说明", "note", "摘要", "交易说明"],
      method: ["支付方式", "付款方式", "method", "渠道"]
    };
    const candidates = aliases[key] || [];
    const exact = headers.find((header) => candidates.some((candidate) => header.toLowerCase() === candidate.toLowerCase()));
    if (exact) return exact;
    return headers.find((header) => candidates.some((candidate) => header.toLowerCase().includes(candidate.toLowerCase()))) || "";
  }

  function renderMappingPanel() {
    if (!importSession) return;
    $("#csv-mapping-panel").hidden = false;
    $("#import-file-copy").textContent = `${importSession.fileName} · ${importSession.encoding} · ${importSession.rows.length} 行数据`;
    $("#mapping-grid").innerHTML = MAPPING_FIELDS.map((field) => `
      <div class="mapping-field">
        <label for="mapping-${field.key}">${field.label}${field.required ? " <em>*</em>" : ""}</label>
        <select id="mapping-${field.key}" data-mapping-key="${field.key}">
          <option value="">不导入</option>
          ${importSession.headers.map((header) => `<option value="${escapeHtml(header)}" ${importSession.mapping[field.key] === header ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}
        </select>
      </div>
    `).join("");
    updateImportPreview();
    setTimeout(() => $("#csv-mapping-panel").scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  function updateImportPreview() {
    if (!importSession) return;
    importPreviewRows = buildImportRows();
    const importable = importPreviewRows.filter((row) => !row.duplicate);
    const duplicateCount = importPreviewRows.length - importable.length;
    $("#import-preview-summary").textContent = `可导入 ${importable.length} 笔${duplicateCount ? ` · 跳过重复 ${duplicateCount} 笔` : ""}`;
    $("#import-count").textContent = importable.length ? `(${importable.length})` : "";
    $("#confirm-import").disabled = !importable.length;
    $("#import-preview-head").innerHTML = `<tr><th>日期</th><th>收支</th><th>分类</th><th>商户 / 摘要</th><th class="align-right">金额</th><th>状态</th></tr>`;
    $("#import-preview-body").innerHTML = importPreviewRows.slice(0, 8).map((row) => {
      const category = findSecondary(row.transaction.type, row.transaction.primaryCategoryId, row.transaction.secondaryCategoryId);
      const primary = findPrimary(row.transaction.type, row.transaction.primaryCategoryId);
      return `<tr>
        <td>${escapeHtml(row.transaction.date)}</td>
        <td>${row.transaction.type === "income" ? "收入" : "支出"}</td>
        <td>${escapeHtml(primary?.name || "未分类")} / ${escapeHtml(category?.name || "未分类")}</td>
        <td>${escapeHtml(row.transaction.merchant || row.transaction.note || "—")}</td>
        <td class="amount-cell ${row.transaction.type === "income" ? "income" : ""}">${row.transaction.type === "income" ? "+" : "-"}${formatMoney(row.transaction.amount)}</td>
        <td><span class="type-badge">${row.duplicate ? "重复跳过" : "可导入"}</span></td>
      </tr>`;
    }).join("");
  }

  function buildImportRows() {
    const { mapping, rows, headers } = importSession;
    const existingKeys = new Set(state.transactions.map(transactionDedupKey));
    const batchKeys = new Set();
    return rows.map((row) => {
      const get = (key) => {
        const header = mapping[key];
        if (!header) return "";
        const index = headers.indexOf(header);
        return index >= 0 ? String(row[index] || "").trim() : "";
      };
      const rawDate = get("date");
      const rawAmount = get("amount");
      if (!rawDate && !rawAmount) return null;
      const date = normalizeImportedDate(rawDate);
      const amountNumber = parseImportedAmount(rawAmount);
      if (!date || !Number.isFinite(amountNumber.value) || amountNumber.value === 0) return null;
      const context = [get("type"), get("merchant"), get("primary"), get("secondary"), get("note")].join(" ");
      let type = typeFromImportedValue(get("type"));
      if (!type) type = amountNumber.negative ? "expense" : detectType(context);
      if (amountNumber.negative) type = "expense";
      const category = resolveImportedCategory(type, get("primary"), get("secondary"), context);
      const tx = {
        id: uid("tx"),
        type,
        amount: Math.round(Math.abs(amountNumber.value) * 100) / 100,
        primaryCategoryId: category.primary.id,
        secondaryCategoryId: category.secondary.id,
        merchant: get("merchant") || category.secondary.name,
        note: get("note"),
        method: normalizeMethod(get("method")) || paymentMethodFromText(context),
        date,
        createdAt: new Date().toISOString()
      };
      if (tx.method === "其他" && !get("method")) tx.method = "其他";
      const key = transactionDedupKey(tx);
      const duplicate = existingKeys.has(key) || batchKeys.has(key);
      batchKeys.add(key);
      return { transaction: tx, duplicate };
    }).filter(Boolean);
  }

  function normalizeImportedDate(value) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const chinese = value.match(/(\d{4})[年/.](\d{1,2})[月/.](\d{1,2})/);
    if (chinese) return normalizeDateParts(chinese[1], chinese[2], chinese[3]);
    const monthDay = value.match(/(\d{1,2})月(\d{1,2})日?/);
    if (monthDay) return normalizeDateParts(new Date().getFullYear(), monthDay[1], monthDay[2]);
    if (/^\d{5}$/.test(value)) {
      const date = new Date((Number(value) - 25569) * 86400 * 1000);
      if (!Number.isNaN(date.getTime())) return localDateString(date);
    }
    const parsed = new Date(value.replaceAll("/", "-"));
    return Number.isNaN(parsed.getTime()) ? "" : localDateString(parsed);
  }

  function parseImportedAmount(value) {
    const text = String(value || "").replace(/[,，¥￥\s]/g, "");
    const negative = /^-|^\(.*\)$/.test(text);
    const number = Number(text.replace(/[()]/g, ""));
    return { value: number, negative: negative || number < 0 };
  }

  function typeFromImportedValue(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return "";
    if (/收入|入账|贷|存入|income|credit|收款/.test(text)) return "income";
    if (/支出|出账|借|消费|expense|debit|付款/.test(text)) return "expense";
    return "";
  }

  function normalizeMethod(value) {
    const text = String(value || "");
    if (/微信/.test(text)) return "微信";
    if (/支付宝/.test(text)) return "支付宝";
    if (/信用卡/.test(text)) return "信用卡";
    if (/银行|储蓄卡|借记卡/.test(text)) return "银行卡";
    if (/现金/.test(text)) return "现金";
    return METHODS.includes(text) ? text : "";
  }

  function resolveImportedCategory(type, primaryText, secondaryText, context) {
    let importedPrimary = primaryText.trim();
    let importedSecondary = secondaryText.trim();
    if (!importedSecondary && /[/>|-]/.test(importedPrimary)) {
      const parts = importedPrimary.split(/[/>|-]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        importedPrimary = parts[0];
        importedSecondary = parts[1];
      }
    }
    const primary = getAllPrimary(type).find((category) => category.name === importedPrimary || importedPrimary.includes(category.name));
    if (primary) {
      const secondary = primary.children.find((child) => child.name === importedSecondary || importedSecondary.includes(child.name));
      if (secondary) return { primary, secondary };
    }
    const classified = classifyText(type, `${primaryText} ${secondaryText} ${context}`);
    if (classified) return { primary: classified.primary, secondary: classified.secondary };
    if (primary?.children[0]) return { primary, secondary: primary.children.find((child) => child.active) || primary.children[0] };
    const fallbackPrimary = getAllPrimary(type).find((category) => category.name === "其他") || getAllPrimary(type)[0];
    return {
      primary: fallbackPrimary,
      secondary: fallbackPrimary?.children.find((child) => child.active) || fallbackPrimary?.children[0]
    };
  }

  function transactionDedupKey(tx) {
    const identity = normalizeMerchant(tx.merchant || tx.note);
    return [tx.date, tx.type, Number(tx.amount).toFixed(2), identity].join("|");
  }

  function confirmImport() {
    const rows = importPreviewRows.filter((row) => !row.duplicate);
    if (!rows.length) return showToast("没有新的流水可以导入。", "error");
    if (state.demo) clearDemoTransactions(false);
    rows.forEach((row) => state.transactions.push(row.transaction));
    saveState();
    const count = rows.length;
    closeImportPanel();
    renderAll();
    showToast(`成功导入 ${count} 笔流水。`);
  }

  function closeImportPanel() {
    importSession = null;
    importPreviewRows = [];
    $("#csv-mapping-panel").hidden = true;
    $("#csv-file-input").value = "";
  }

  function downloadBlob(content, type, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv(rows = null, filename = null) {
    const included = rows || sortTransactions(state.transactions);
    const header = ["日期", "类型", "一级分类", "二级分类", "商户", "备注", "支付方式", "金额"];
    const body = included.map((tx) => {
      const { primary, secondary } = resolveCategory(tx);
      return [
        tx.date,
        tx.type === "income" ? "收入" : "支出",
        primary.name,
        secondary.name,
        tx.merchant,
        tx.note,
        tx.method,
        tx.amount.toFixed(2)
      ].map(escapeCsv).join(",");
    });
    const content = `\uFEFF${header.join(",")}\r\n${body.join("\r\n")}\r\n`;
    downloadBlob(content, "text/csv;charset=utf-8", filename || `AuCost-流水-${localDateString()}.csv`);
  }

  function downloadCsvTemplate() {
    const header = ["日期", "类型", "一级分类", "二级分类", "商户", "备注", "支付方式", "金额"];
    const rows = [
      [localDateString(), "支出", "餐饮", "午餐", "山野食堂", "工作日午餐", "微信", "35.00"],
      [localDateString(), "收入", "工作收入", "工资", "月度工资", "工资到账", "银行卡", "12000.00"]
    ];
    const content = `\uFEFF${header.join(",")}\r\n${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
    downloadBlob(content, "text/csv;charset=utf-8", "AuCost-导入模板.csv");
    showToast("CSV 模板已下载。");
  }

  function exportJson() {
    const payload = {
      app: "AuCost",
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: state
    };
    downloadBlob(JSON.stringify(payload, null, 2), "application/json;charset=utf-8", `AuCost-备份-${localDateString()}.json`);
    showToast("完整账本备份已导出。");
  }

  async function importJsonFile(file) {
    try {
      const payload = JSON.parse(await file.text());
      const candidate = payload?.data || payload;
      const normalized = normalizeState(candidate);
      if (!window.confirm("恢复备份会替换当前账本，确定继续吗？")) return;
      state = normalized;
      state.demo = false;
      saveState();
      selectedMonth = currentMonthKey();
      renderAll();
      showToast("账本已从备份恢复。");
    } catch (error) {
      console.error(error);
      showToast(error.message || "无法读取这个备份文件。", "error");
    } finally {
      $("#json-file-input").value = "";
    }
  }

  function resetData() {
    if (!window.confirm("这会永久删除当前浏览器中的全部账本数据，确定继续吗？")) return;
    state = createBaseState(false);
    saveState();
    selectedMonth = currentMonthKey();
    renderAll();
    showToast("本地账本已重置。");
  }

  function showToast(message, type = "success") {
    const region = $("#toast-region");
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : ""}`;
    toast.innerHTML = `<span class="toast-icon">${iconUse(type === "error" ? "alert" : "check")}</span><span>${escapeHtml(message)}</span>`;
    region.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("leaving");
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    lastFocusedElement = lastFocusedElement || document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (!modal?.classList.contains("open")) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!$(".modal-backdrop.open")) document.body.classList.remove("modal-open");
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  function handleDocumentClick(event) {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }
    const addButton = event.target.closest('[data-action="add-transaction"]');
    if (addButton) {
      openTransactionModal();
      return;
    }
    const editTxButton = event.target.closest("[data-edit-tx]");
    if (editTxButton) {
      const tx = state.transactions.find((item) => item.id === editTxButton.dataset.editTx);
      if (tx) openTransactionModal(tx);
      return;
    }
    const deleteTxButton = event.target.closest("[data-delete-tx]");
    if (deleteTxButton) {
      deleteTransaction(deleteTxButton.dataset.deleteTx);
      return;
    }
    const addPrimaryButton = event.target.closest("[data-add-primary]");
    if (addPrimaryButton) {
      openCategoryModal({ mode: "add-primary", type: addPrimaryButton.dataset.addPrimary });
      return;
    }
    const addChildButton = event.target.closest("[data-add-child]");
    if (addChildButton) {
      const type = addChildButton.dataset.categoryType;
      const primary = findPrimary(type, addChildButton.dataset.addChild);
      if (primary) openCategoryModal({ mode: "add-child", type, primary });
      return;
    }
    const editCategoryButton = event.target.closest("[data-edit-category]");
    if (editCategoryButton) {
      const type = editCategoryButton.dataset.categoryType;
      const level = editCategoryButton.dataset.categoryLevel;
      if (level === "primary") {
        const primary = findPrimary(type, editCategoryButton.dataset.editCategory);
        if (primary) openCategoryModal({ mode: "edit-primary", type, primary });
      } else {
        const primary = findPrimary(type, editCategoryButton.dataset.parentId);
        const secondary = primary?.children.find((child) => child.id === editCategoryButton.dataset.editCategory);
        if (primary && secondary) openCategoryModal({ mode: "edit-child", type, primary, secondary });
      }
      return;
    }
    const deleteRuleButton = event.target.closest("[data-delete-rule]");
    if (deleteRuleButton) {
      state.rules = state.rules.filter((rule) => rule.id !== deleteRuleButton.dataset.deleteRule);
      saveState();
      renderDataTools();
      showToast("自动分类规则已删除。");
      return;
    }
    const closeButton = event.target.closest("[data-close]");
    if (closeButton) {
      closeModal(closeButton.dataset.close);
      return;
    }
    if (event.target.classList.contains("modal-backdrop")) {
      closeModal(event.target.id);
    }
  }

  function handleDocumentKeydown(event) {
    if (event.key === "Escape") {
      const open = $(".modal-backdrop.open");
      if (open) closeModal(open.id);
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && activeView === "overview") {
      event.preventDefault();
      submitSmartTransaction();
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeydown);
    $("#prev-month").addEventListener("click", () => {
      selectedMonth = shiftMonth(selectedMonth, -1);
      renderAll();
    });
    $("#next-month").addEventListener("click", () => {
      selectedMonth = shiftMonth(selectedMonth, 1);
      renderAll();
    });
    $("#month-label").addEventListener("click", () => {
      selectedMonth = currentMonthKey();
      renderAll();
    });
    $("#smart-input").addEventListener("input", renderSmartDetection);
    $("#smart-submit").addEventListener("click", submitSmartTransaction);
    $("#smart-edit").addEventListener("click", () => {
      if (smartDraft) openTransactionModal(smartDraft);
    });
    $$(".suggestion").forEach((button) => {
      button.addEventListener("click", () => {
        $("#smart-input").value = button.dataset.suggestion;
        renderSmartDetection();
        $("#smart-input").focus();
      });
    });
    $("#clear-demo-banner").addEventListener("click", () => {
      if (window.confirm("清空全部示例流水、示例预算和示例规则？分类会保留。")) clearDemoTransactions();
    });
    $("#sidebar-demo-clear").addEventListener("click", () => {
      setView("data");
      showToast("AuCost 不连接服务器，所有账本仅保存在当前浏览器。");
    });
    $("#ledger-search").addEventListener("input", renderLedger);
    $("#ledger-type").addEventListener("change", renderLedger);
    $("#ledger-category").addEventListener("change", renderLedger);
    $("#ledger-method").addEventListener("change", renderLedger);
    $("#new-primary-category").addEventListener("click", () => openCategoryModal({ mode: "add-primary", type: "expense" }));
    $("#category-form").addEventListener("submit", handleCategorySubmit);
    $("#transaction-form").addEventListener("submit", handleTransactionSubmit);
    $$('input[name="transaction-type"]').forEach((input) => {
      input.addEventListener("change", () => handleTransactionTypeChange(input.value));
    });
    $("#transaction-primary").addEventListener("change", (event) => {
      const type = $('input[name="transaction-type"]:checked').value;
      populateSecondaryCategories(type, event.target.value);
    });
    $("#save-total-budget").addEventListener("click", saveTotalBudget);
    $("#category-budget-list").addEventListener("change", (event) => {
      if (event.target.matches("[data-category-budget]")) saveCategoryBudget(event.target);
    });
    $("#csv-file-input").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        await readCsvFile(file);
      } catch (error) {
        console.error(error);
        showToast(error.message || "无法读取这个 CSV 文件。", "error");
        event.target.value = "";
      }
    });
    $("#mapping-grid").addEventListener("change", (event) => {
      if (!event.target.matches("[data-mapping-key]")) return;
      importSession.mapping[event.target.dataset.mappingKey] = event.target.value;
      updateImportPreview();
    });
    $("#confirm-import").addEventListener("click", confirmImport);
    $("#cancel-import").addEventListener("click", closeImportPanel);
    $("#close-mapping").addEventListener("click", closeImportPanel);
    $("#download-csv-template").addEventListener("click", downloadCsvTemplate);
    $("#export-csv").addEventListener("click", () => exportCsv());
    $("#export-json").addEventListener("click", exportJson);
    $("#json-file-input").addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) importJsonFile(file);
    });
    $("#reset-data").addEventListener("click", resetData);
    setupSpeechRecognition();
  }

  function init() {
    loadState();
    bindEvents();
    renderSmartDetection();
    renderAll();
  }

  init();
})();
