/* 用户故事拆卡 · 面板与入口
 *
 * 入口：每张流程图（服务蓝图）标题栏右上角 —— 本场景的卡、全部场景的卡。
 * 面板四个视图：
 *   时间线总览  12 个模块按依赖顺序排的设计／开发排期，先看多久，再往下看卡
 *   按角色 ／ 按 Epic ／ 按流程顺序  同一批卡的三种分组
 * 复用页面已有的 .roleView 覆盖层与角色配色（roleType／roleClass），不另造一套。
 *
 * 数据：window.STORY_EPICS / STORY_CARDS（卡）、window.STORY_EST（人天）。
 * 只读，不改蓝图，不进 persistBlueprint，不占本地存储。
 */
(function () {
  if (!window.STORY_CARDS || !window.STORY_EPICS) return;

  var EPICS = window.STORY_EPICS, CARDS = window.STORY_CARDS, EST = window.STORY_EST || {};
  var PRIO = { M: ['必须', 'svPm'], S: ['应该', 'svPs'], C: ['可选', 'svPc'] };
  var VIEWS = [['time', '时间线总览'], ['role', '按角色'], ['epic', '按 Epic'], ['step', '按流程顺序']];

  /* 模块的交付顺序。不是业务顺序，是依赖顺序 —— 配置里的权限、字典、时效、通知是别处一切的前提，
     档案要等各流程把操作人和单号写全，任务中心要等各流程的任务定下来，所以压在后面。
     顺序只影响时间线怎么排，不影响人天合计。 */
  var ORDER = [
    '配置 · 系统管理中心', '流程1 发运建档', '流程2 到货验收', '流程3 领料安装',
    '流程4 注册上线', '流程5 日常运维', '流程6 临期提醒', '流程7 固资回收',
    '任务 · 工单与看板', '档案 · 资产档案', '初始化 · 历史资产', '前置 · 需求与采购'
  ];
  var WORKDAYS = 5;            /* 一周按 5 个工作日算 */
  var scope = '', view = 'time', openModule = '';
  var dzN = 1, dvN = 2, onlyNow = true;   /* 设计 1 人、开发 2 人；默认只看本期 */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function plain(v) { return String(v == null ? '' : v).replace(/<[^>]+>/g, '').trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function n1(x) { return Math.round(x * 10) / 10; }
  function rk(r) { return (typeof roleType === 'function' ? roleType(r).k : 'other'); }
  function rn(r) { return (typeof roleType === 'function' ? roleType(r).name : '其他'); }
  function scene(sid) {
    if (typeof singleScenarios === 'undefined') return null;
    return singleScenarios.find(function (x) { return x[0] === sid; }) || null;
  }
  function sceneLabel(sid) {
    var s = scene(sid);
    return s ? plain(s[2] || s[1] || sid) : sid.toUpperCase() + '（该场景当前未显示）';
  }
  function stepLabel(sid, i) {
    var s = scene(sid);
    if (!s || !s[4] || !s[4][i]) return '第 ' + pad2(i + 1) + ' 步';
    return '第 ' + pad2(i + 1) + ' 步「' + plain(s[4][i][1]) + '」';
  }
  function epic(id) {
    for (var i = 0; i < EPICS.length; i++) if (EPICS[i][0] === id) return EPICS[i];
    return [id, id, '', ''];
  }
  function stageOf(c) { return epic(c.e)[2] || '未归类'; }

  /* 一张卡：带卡号、人天、所属模块 */
  function cardsOf(sid) {
    return (CARDS[sid] || []).map(function (c, n) {
      var uid = 'US-' + sid.toUpperCase() + '-' + pad2(n + 1);
      var t = EST[uid] || [0, 0, c.t];
      return {
        sid: sid, uid: uid, i: c.i, e: c.e, r: c.r, t: c.t, w: c.w, v: c.v,
        a: c.a || [], q: c.q || [], p: c.p || 'S',
        dz: t[0], dv: t[1], stage: stageOf(c),
        /* 不在本期范围：未来方案整条，以及标了（待废弃）的卡 */
        later: sid === 'future' || /（待废弃）/.test(c.t)
      };
    });
  }
  function cardsIn(sc) {
    if (sc && sc.indexOf('stage:') === 0) {
      var st = sc.slice(6), out = [];
      Object.keys(CARDS).forEach(function (sid) {
        cardsOf(sid).forEach(function (c) { if (c.stage === st) out.push(c); });
      });
      return out;
    }
    if (sc !== '*') return cardsOf(sc);
    var all = [];
    Object.keys(CARDS).forEach(function (sid) { all = all.concat(cardsOf(sid)); });
    return all;
  }
  function scopeLabel(sc) {
    if (sc === '*') return '全部场景';
    if (sc.indexOf('stage:') === 0) return sc.slice(6);
    return sceneLabel(sc);
  }
  window.storyCardCount = function (sid) { return (CARDS[sid] || []).length; };

  function sum(list) {
    var r = { n: 0, dz: 0, dv: 0, q: 0, must: 0, later: 0 };
    list.forEach(function (c) {
      if (onlyNow && c.later) { r.later++; return; }
      r.n++; r.dz += c.dz; r.dv += c.dv; r.q += c.q.length;
      if (c.p === 'M') r.must++;
    });
    return r;
  }
  /* 两段流水线：设计先行，开发跟着做 —— 开发每个模块的开工时间取
     「本模块设计做完」和「上一个模块开发做完」里更晚的那个。 */
  function timeline() {
    var byStage = {};
    cardsIn('*').forEach(function (c) {
      (byStage[c.stage] = byStage[c.stage] || []).push(c);
    });
    var names = ORDER.filter(function (s) { return byStage[s]; })
      .concat(Object.keys(byStage).filter(function (s) { return ORDER.indexOf(s) < 0; }));
    var dzEnd = 0, dvEnd = 0;
    var rows = names.map(function (s) {
      var g = sum(byStage[s]);
      var dzW = g.dz / dzN / WORKDAYS, dvW = g.dv / dvN / WORKDAYS;
      var dzStart = dzEnd; dzEnd += dzW;
      var dvStart = Math.max(dzEnd, dvEnd); dvEnd = dvStart + dvW;
      return { name: s, g: g, dzStart: dzStart, dzW: dzW, dvStart: dvStart, dvW: dvW,
        ownW: dzW + dvW, endW: dvEnd };
    });
    return { rows: rows, totalW: dvEnd,
      serialW: rows.reduce(function (a, r) { return a + r.ownW; }, 0) };
  }

  var css = document.createElement('style');
  css.textContent =
    '.svEntry{position:absolute;right:18px;top:15px;display:flex;gap:6px;align-items:center}' +
    '.svBtn{font:inherit;font-size:12px;padding:6px 11px;border:1px solid #c9b6e8;border-radius:7px;' +
      'background:#f8f5fe;color:#4b3ea8;cursor:pointer;white-space:nowrap}' +
    '.svBtn b{font-size:12.5px}.svBtn em{font-style:normal;color:#7a6fc0}' +
    '.svBtn:hover{background:#efe9fc;border-color:#5b4bc4}' +
    '.svBtn.svGhost{border-color:#d7dfea;background:#fbfdff;color:#51607a}' +
    '.svBtn.svGhost:hover{background:#f1f6ff;border-color:#2459ee}' +
    '.svHint{padding:10px 18px;border-bottom:1px solid #eef2f7;background:#fcfbff;' +
      'font-size:11.5px;line-height:1.7;color:#5a6b80}' +
    '.svHint b{color:#4b3ea8}' +
    '.svTools{display:flex;flex-wrap:wrap;gap:6px;padding:12px 18px 10px;align-items:center}' +
    '.svTools .svSpacer{margin-left:auto}' +
    '.svTab{font:inherit;font-size:12px;padding:5px 11px;border:1px solid #d7dfea;border-radius:14px;' +
      'background:#fbfdff;color:#51607a;cursor:pointer}' +
    '.svTab.on{background:#4b3ea8;border-color:#4b3ea8;color:#fff}' +
    '.svStat{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 12px;border-bottom:1px solid #eef2f7}' +
    '.svStat div{flex:1 1 92px;padding:7px 10px;border:1px solid #e3e9f1;border-radius:7px;background:#fafcff}' +
    '.svStat b{display:block;font-size:17px;line-height:1.3;color:#1f2d3d}' +
    '.svStat span{font-size:10px;color:#6a7686}' +
    '.svStat div.svKey{background:#f4f1fd;border-color:#d8cff3}' +
    '.svStat div.svKey b{color:#4b3ea8}' +
    /* 假设控制条 */
    '.svAssume{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 18px;' +
      'background:#f7f9fc;border-bottom:1px solid #eef2f7;font-size:11.5px;color:#51607a}' +
    '.svAssume select{font:inherit;font-size:11.5px;border:1px solid #cfd9e6;border-radius:5px;' +
      'padding:3px 5px;background:#fff;color:#24364d}' +
    '.svAssume label{display:inline-flex;align-items:center;gap:5px}' +
    /* 甘特表 */
    '.svGantt{padding:4px 18px 10px}' +
    '.svRow{display:grid;grid-template-columns:148px 56px 92px 1fr;gap:9px;align-items:center;' +
      'padding:6px 0;border-bottom:1px solid #f0f3f8}' +
    '.svRow.svHead{font-size:10.5px;color:#8a949e;border-bottom:1px solid #e3e9f1;padding-bottom:4px}' +
    '.svRow .svMod{font-size:12px;color:#24364d;cursor:pointer;text-align:left;background:none;' +
      'border:0;font-family:inherit;padding:0}' +
    '.svRow .svMod:hover{color:#2459ee;text-decoration:underline}' +
    '.svRow.svNow .svMod{font-weight:700;color:#4b3ea8}' +
    '.svRow .svNum{font-size:11px;color:#51607a;text-align:right}' +
    '.svRow .svDays{font-size:10.5px;color:#7a8694}' +
    '.svTrack{position:relative;height:17px;background:#f4f7fb;border-radius:4px}' +
    '.svBar{position:absolute;top:2px;height:13px;border-radius:3px;font-size:9px;line-height:13px;' +
      'color:#fff;text-align:center;overflow:hidden;white-space:nowrap}' +
    '.svBarDz{background:#8d7ed8}.svBarDv{background:#2f7fd1}' +
    '.svRow.svNow .svTrack{background:#efeafb}' +
    '.svTick{position:relative;height:14px;margin:2px 0 0;font-size:9px;color:#9aa6b6}' +
    '.svTick span{position:absolute;transform:translateX(-50%)}' +
    '.svLegend{display:flex;gap:12px;align-items:center;padding:6px 18px 2px;font-size:10.5px;color:#7a8694}' +
    '.svLegend i{display:inline-block;width:18px;height:8px;border-radius:2px;margin-right:4px;vertical-align:0}' +
    '.svSub{padding:2px 0 8px 10px;border-left:2px solid #e3e9f1;margin:0 0 6px 6px}' +
    '.svSub button{display:block;width:100%;text-align:left;font:inherit;font-size:11.5px;' +
      'color:#24364d;background:#fbfdff;border:1px solid #e9eef5;border-radius:6px;' +
      'padding:5px 9px;margin-bottom:4px;cursor:pointer}' +
    '.svSub button:hover{border-color:#2459ee;background:#f4f8ff}' +
    '.svSub button em{font-style:normal;color:#7a8694;font-size:10.5px}' +
    '.svFoot{padding:8px 18px 16px;font-size:11px;line-height:1.75;color:#7a8694}' +
    '.svFoot b{color:#8a5a00}';
  document.head.appendChild(css);

  var css2 = document.createElement('style');
  css2.textContent =
    '.svCard{border:1px solid #e3e9f1;border-left:4px solid var(--rc,#8a949e);border-radius:8px;' +
      'padding:10px 12px;margin-bottom:8px;background:#fff}' +
    '.svCard.svLater{background:#fcfcfd;border-left-style:dashed;opacity:.85}' +
    '.svTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.svTop i{font-style:normal;font-size:10.5px;font-weight:700;color:#8a949e;' +
      'font-family:ui-monospace,Menlo,monospace}' +
    '.svTop strong{font-size:13px;color:#1f2d3d}' +
    '.svP{font-size:10px;font-weight:700;border-radius:3px;padding:1px 6px}' +
    '.svPm{background:#fde9e6;color:#9b3a2d}.svPs{background:#e9e6fb;color:#4b3ea8}' +
    '.svPc{background:#eef1f4;color:#5a6672}' +
    '.svEst{margin-left:auto;display:inline-flex;gap:4px;align-items:center;font-size:10px}' +
    '.svEst em{font-style:normal;border-radius:3px;padding:1px 6px;white-space:nowrap}' +
    '.svEst .svEz{background:#efeafb;color:#4b3ea8}' +
    '.svEst .svEv{background:#e7f1fb;color:#1f5f9c}' +
    '.svEst .svEt{background:#f1f4f8;color:#51607a;font-weight:700}' +
    '.svStory{margin:7px 0 0;font-size:12.5px;line-height:1.75;color:#24364d}' +
    '.svStory b{color:#1f2d3d}' +
    '.svMeta{margin-top:6px;font-size:10.5px;color:#7a8694}' +
    '.svMeta code{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#4b3ea8;' +
      'background:#f4f1fd;border-radius:3px;padding:1px 5px;margin-right:5px}' +
    '.svList{margin:7px 0 0;padding:0 0 0 2px;list-style:none}' +
    '.svList li{position:relative;padding-left:14px;margin-bottom:3px;font-size:11.5px;' +
      'line-height:1.7;color:#3c4a5c}' +
    '.svList li:before{position:absolute;left:2px;top:0;content:"\\2022";color:#9aa6b6}' +
    '.svLab{display:block;margin-top:8px;font-size:10.5px;font-weight:700;color:#54637a;' +
      'letter-spacing:.03em}' +
    '.svQ .svLab,.svQ li{color:#8a5a00}' +
    '.svQ li:before{content:"?";font-weight:700;color:#c08a1e}' +
    '.svGo{margin-top:9px;font:inherit;font-size:11px;padding:4px 9px;border:1px solid #dde6f2;' +
      'border-radius:5px;background:#fbfdff;color:#24364d;cursor:pointer;text-align:left}' +
    '.svGo:hover{border-color:#2459ee;background:#eff5ff}' +
    '.svGrpHead{margin:16px 0 7px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}' +
    '.svGrpHead h4{margin:0;font-size:12.5px;color:#30435b}' +
    '.svGrpHead small{font-size:10px;font-weight:600;color:#8a949e;background:#f1f4f8;' +
      'border-radius:3px;padding:1px 6px}' +
    '.svGrpHead em{font-style:normal;font-size:10.5px;color:#7a8694}' +
    '.svGrpHead .svGrpEst{margin-left:auto;font-size:10.5px;color:#4b3ea8}';
  document.head.appendChild(css2);

  function estHtml(c) {
    return '<span class="svEst"><em class="svEz">设计 ' + n1(c.dz) + '</em>' +
      '<em class="svEv">开发 ' + n1(c.dv) + '</em>' +
      '<em class="svEt">' + n1(c.dz + c.dv) + ' 人天</em></span>';
  }

  function cardHtml(c, showScene) {
    var k = rk(c.r), e = epic(c.e), pr = PRIO[c.p] || PRIO.S;
    var ac = c.a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    var q = c.q.length ? '<div class="svQ"><span class="svLab">待确认（没拍板前别进 Sprint）</span><ul class="svList">'
      + c.q.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '';
    return '<div class="svCard role-' + k + (c.later ? ' svLater' : '') + '">' +
      '<div class="svTop"><i>' + esc(c.uid) + '</i><strong>' + esc(c.t) + '</strong>' +
        '<em class="rvRole role-' + k + '">' + esc(c.r) + '</em>' +
        '<b class="svP ' + pr[1] + '">' + pr[0] + '</b>' +
        (c.later ? '<b class="svP svPc">不在本期</b>' : '') + estHtml(c) + '</div>' +
      '<p class="svStory">作为 <b>' + esc(c.r) + '</b>，我希望' + esc(c.w) + '，以便' + esc(c.v) + '。</p>' +
      '<div class="svMeta"><code>' + esc(c.e) + '</code>' + esc(e[1]) + ' · ' + esc(e[2]) +
        (showScene ? '　｜　场景：' + esc(sceneLabel(c.sid)) : '') + '</div>' +
      '<span class="svLab">验收标准</span><ul class="svList">' + ac + '</ul>' + q +
      '<button type="button" class="svGo" onclick="storyViewGo(\'' + c.sid + '\',' + c.i + ')">' +
        '定位到 ' + esc(c.sid.toUpperCase()) + ' ' + esc(stepLabel(c.sid, c.i)) + ' \u2192</button>' +
      '</div>';
  }

  /* 分组：返回 [{key,name,note,cards}] */
  function groupCards(list, mode, sc) {
    var order = [], map = {};
    function put(key, name, note, c) {
      if (!map[key]) { map[key] = { key: key, name: name, note: note, cards: [] }; order.push(key); }
      map[key].cards.push(c);
    }
    if (mode === 'role') {
      list.forEach(function (c) { put(rk(c.r), rn(c.r), '', c); });
      order.sort(function (a, b) { return map[b].cards.length - map[a].cards.length; });
    } else if (mode === 'epic') {
      list.forEach(function (c) { var e = epic(c.e); put(c.e, e[1], e[2], c); });
    } else if (sc === '*' || sc.indexOf('stage:') === 0) {
      list.forEach(function (c) { put(c.sid, sceneLabel(c.sid), c.sid.toUpperCase(), c); });
    } else {
      list.slice().sort(function (a, b) { return a.i - b.i; })
        .forEach(function (c) { put('s' + c.i, stepLabel(c.sid, c.i), '', c); });
    }
    return order.map(function (k) { return map[k]; });
  }

  function cardsHtml(list, sc) {
    var showScene = (sc === '*' || sc.indexOf('stage:') === 0);
    return groupCards(list, view, sc).map(function (g) {
      var s = sum(g.cards);
      return '<div class="svGrp"><div class="svGrpHead"><h4>' + esc(g.name) + '</h4>' +
        '<small>' + g.cards.length + ' 张</small>' +
        (g.note ? '<em>' + esc(g.note) + '</em>' : '') +
        '<span class="svGrpEst">设计 ' + n1(s.dz) + ' ＋ 开发 ' + n1(s.dv) +
          ' ＝ ' + n1(s.dz + s.dv) + ' 人天</span></div>' +
        g.cards.map(function (c) { return cardHtml(c, showScene && view !== 'step'); }).join('') +
        '</div>';
    }).join('');
  }

  function weeks(w) { return w < 0.05 ? '—' : n1(w) + ' 周'; }

  function ganttHtml() {
    var tl = timeline(), total = tl.totalW || 1;
    var nowStage = '';
    if (scope && scope.indexOf('stage:') === 0) nowStage = scope.slice(6);
    else if (scope && scope !== '*' && CARDS[scope] && CARDS[scope][0]) nowStage = stageOf(CARDS[scope][0]);
    var ticks = '';
    for (var m = 0; m <= Math.ceil(total / 4.345); m += 1) {
      var w = m * 4.345; if (w > total) break;
      ticks += '<span style="left:' + (w / total * 100) + '%">' + (m ? '第 ' + m + ' 月' : '开工') + '</span>';
    }
    var rows = tl.rows.map(function (r) {
      var risk = r.g.q >= 25 ? '⚠ ' + r.g.q : r.g.q;
      var open = openModule === r.name;
      var sub = '';
      if (open) {
        var byScene = {};
        cardsIn('*').forEach(function (c) {
          if (c.stage !== r.name) return;
          if (onlyNow && c.later) return;
          (byScene[c.sid] = byScene[c.sid] || []).push(c);
        });
        sub = '<div class="svSub">' + Object.keys(byScene).map(function (sid) {
          var s = sum(byScene[sid]);
          return '<button type="button" onclick="openStoryView(\'' + sid + '\',\'role\')">' +
            esc(sid.toUpperCase()) + '　' + esc(sceneLabel(sid)) +
            '　<em>' + s.n + ' 张 · 设计 ' + n1(s.dz) + ' ＋ 开发 ' + n1(s.dv) +
            ' ＝ ' + n1(s.dz + s.dv) + ' 人天</em></button>';
        }).join('') +
          '<button type="button" onclick="openStoryView(\'stage:' + esc(r.name) + '\',\'role\')">' +
          '展开这个模块的全部 ' + r.g.n + ' 张卡 \u2192</button></div>';
      }
      return '<div class="svRow' + (r.name === nowStage ? ' svNow' : '') + '">' +
        '<button type="button" class="svMod" onclick="storyViewModule(\'' + esc(r.name) + '\')">' +
          (open ? '\u25be ' : '\u25b8 ') + esc(r.name) + '</button>' +
        '<span class="svNum">' + r.g.n + ' 张</span>' +
        '<span class="svDays">设计 ' + n1(r.g.dz) + ' ／ 开发 ' + n1(r.g.dv) + '</span>' +
        '<div><div class="svTrack">' +
          (r.dzW > 0 ? '<div class="svBar svBarDz" style="left:' + (r.dzStart / total * 100) +
            '%;width:' + Math.max(r.dzW / total * 100, 1.2) + '%">' + (r.dzW >= 1 ? n1(r.dzW) : '') + '</div>' : '') +
          (r.dvW > 0 ? '<div class="svBar svBarDv" style="left:' + (r.dvStart / total * 100) +
            '%;width:' + Math.max(r.dvW / total * 100, 1.2) + '%">' + (r.dvW >= 1 ? n1(r.dvW) + ' 周' : '') + '</div>' : '') +
        '</div></div></div>' + sub +
        '<div class="svRow" style="border:0;padding:0 0 4px;grid-template-columns:148px 56px 92px 1fr">' +
          '<span></span><span class="svNum" style="color:#9aa6b6">待确认 ' + risk + '</span>' +
          '<span class="svDays">本模块 ' + weeks(r.ownW) + '</span>' +
          '<span class="svDays">做完约在第 ' + n1(r.endW) + ' 周（≈ ' + n1(r.endW / 4.345) + ' 个月）</span>' +
        '</div>';
    }).join('');
    return '<div class="svLegend"><span><i class="svBarDz"></i>设计</span>' +
      '<span><i class="svBarDv"></i>开发</span>' +
      '<span>条上的数字是周数；设计做完下一个模块的设计就接着开工，开发排在设计之后。</span></div>' +
      '<div class="svGantt"><div class="svRow svHead"><span>模块（按依赖顺序）</span>' +
      '<span style="text-align:right">卡</span><span>人天</span><span>排期</span></div>' +
      rows + '<div class="svTick">' + ticks + '</div></div>';
  }

  function assumeHtml() {
    function sel(id, val, max, label) {
      var o = '';
      for (var i = 1; i <= max; i++) o += '<option value="' + i + '"' + (i === val ? ' selected' : '') + '>' + i + '</option>';
      return '<label>' + label + '<select onchange="storyViewAssume(\'' + id + '\',this.value)">' + o + '</select>人</label>';
    }
    return '<div class="svAssume">' +
      '<span>换算假设：</span>' + sel('dz', dzN, 4, '设计') + sel('dv', dvN, 6, '开发') +
      '<span>一周 5 个工作日</span>' +
      '<label><input type="checkbox"' + (onlyNow ? ' checked' : '') +
        ' onchange="storyViewAssume(\'now\',this.checked)">只看本期（排除未来方案与待废弃）</label>' +
      '</div>';
  }

  function footHtml(tl) {
    return '<div class="svFoot">' +
      '口径：人天＝一个人干一天，不是日历天；开发含前后端，<b>不含测试、UAT、联调等待、返工与审批等待</b>。' +
      '照经验这几项通常再加 30%～50%，排期时请在这个基础上留缓冲。<br>' +
      '时间线按两段流水线算：设计先行，某个模块的开发等它自己的设计做完、且上一个模块的开发腾出手。' +
      '若完全串行（设计做完整套再开发），需要 ' + weeks(tl.serialW) + '。<br>' +
      '模块顺序是依赖顺序不是业务顺序 —— 配置里的权限、字典、时效、通知是别处的前提；' +
      '档案要等各流程把操作人和单号写全；任务中心要等各流程的任务定下来。<br>' +
      '<b>待确认多的模块风险高</b>：口径一变，那几张卡的估算就得重算。' +
      '</div>';
  }

  function paint() {
    var layer = document.getElementById('storyView');
    if (!layer) return;
    var list = cardsIn(scope), s = sum(list), tl = timeline();
    var body = view === 'time' ? assumeHtml() + ganttHtml() + footHtml(tl) : cardsHtml(list, scope);
    layer.querySelector('.rvBody').innerHTML = body ||
      '<p class="rvEmpty">这个范围里还没有卡片。</p>';
    var stat = layer.querySelector('.svStat');
    if (stat) stat.innerHTML = view === 'time'
      ? '<div class="svKey"><b>' + n1(tl.totalW) + ' 周</b><span>全部做完（≈ ' + n1(tl.totalW / 4.345) + ' 个月）</span></div>' +
        '<div><b>' + sum(cardsIn('*')).n + '</b><span>' + (onlyNow ? '本期故事卡' : '故事卡（含未来方案）') + '</span></div>' +
        '<div><b>' + n1(sum(cardsIn('*')).dz) + '</b><span>设计人天</span></div>' +
        '<div><b>' + n1(sum(cardsIn('*')).dv) + '</b><span>开发人天</span></div>' +
        '<div><b>' + sum(cardsIn('*')).q + '</b><span>待确认事项</span></div>'
      : '<div><b>' + s.n + '</b><span>故事卡</span></div>' +
        '<div class="svKey"><b>' + n1(s.dz + s.dv) + '</b><span>人天（设计 ' + n1(s.dz) + ' ＋ 开发 ' + n1(s.dv) + '）</span></div>' +
        '<div><b>' + n1(Math.max(s.dz / dzN, 0) / WORKDAYS + s.dv / dvN / WORKDAYS) + ' 周</b><span>按当前人数估</span></div>' +
        '<div><b>' + s.must + '</b><span>必须做</span></div>' +
        '<div><b>' + s.q + '</b><span>待确认事项</span></div>';
    Array.prototype.forEach.call(layer.querySelectorAll('.svTab[data-v]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === view);
    });
  }

  window.storyViewAssume = function (what, val) {
    if (what === 'dz') dzN = Number(val) || 1;
    else if (what === 'dv') dvN = Number(val) || 1;
    else onlyNow = !!val;
    paint();
  };
  window.storyViewTab = function (v) { view = v; paint(); };
  window.storyViewModule = function (name) {
    openModule = (openModule === name ? '' : name); paint();
  };

  function markdown(list, title) {
    var s = sum(list);
    var out = ['# 用户故事拆卡 · ' + title, '',
      '合计 ' + s.n + ' 张卡：设计 ' + n1(s.dz) + ' 人天 ＋ 开发 ' + n1(s.dv) +
        ' 人天 ＝ ' + n1(s.dz + s.dv) + ' 人天（不含测试、联调等待与返工）', ''];
    groupCards(list, view === 'time' ? 'epic' : view, scope).forEach(function (g) {
      var gs = sum(g.cards);
      out.push('## ' + g.name + (g.note ? '（' + g.note + '）' : '') + ' · ' + g.cards.length +
        ' 张 · ' + n1(gs.dz + gs.dv) + ' 人天', '');
      g.cards.forEach(function (c) {
        var e = epic(c.e);
        out.push('### ' + c.uid + ' ' + c.t);
        out.push('- 角色：' + c.r + '　Epic：' + c.e + ' ' + e[1] + '　优先级：' + (PRIO[c.p] || PRIO.S)[0]);
        out.push('- 估算：设计 ' + n1(c.dz) + ' 人天 ＋ 开发 ' + n1(c.dv) + ' 人天' + (c.later ? '（不在本期）' : ''));
        out.push('- 故事：作为 ' + c.r + '，我希望' + c.w + '，以便' + c.v + '。');
        out.push('- 对应步骤：' + c.sid.toUpperCase() + ' ' + stepLabel(c.sid, c.i));
        out.push('- 验收标准：');
        c.a.forEach(function (x) { out.push('  - ' + x); });
        if (c.q.length) { out.push('- 待确认：'); c.q.forEach(function (x) { out.push('  - ' + x); }); }
        out.push('');
      });
    });
    return out.join('\n');
  }
  function timelineMd() {
    var tl = timeline();
    var out = ['# 模块排期总览（设计 ' + dzN + ' 人 ／ 开发 ' + dvN + ' 人，一周 5 个工作日）', '',
      '| 模块 | 卡 | 设计人天 | 开发人天 | 本模块工期 | 做完约在第几周 | 待确认 |',
      '|---|---|---|---|---|---|---|'];
    tl.rows.forEach(function (r) {
      out.push('| ' + r.name + ' | ' + r.g.n + ' | ' + n1(r.g.dz) + ' | ' + n1(r.g.dv) +
        ' | ' + weeks(r.ownW) + ' | ' + n1(r.endW) + ' | ' + r.g.q + ' |');
    });
    out.push('', '全部做完约 ' + weeks(tl.totalW) + '（≈ ' + n1(tl.totalW / 4.345) +
      ' 个月）；完全串行需 ' + weeks(tl.serialW) + '。不含测试、UAT、联调等待、返工与审批等待。');
    return out.join('\n');
  }

  window.storyViewCopy = function () {
    var text = view === 'time' ? timelineMd() : markdown(cardsIn(scope), scopeLabel(scope));
    function done() {
      if (typeof showToast === 'function')
        showToast(view === 'time' ? '已复制模块排期总览（Markdown）'
          : '已复制 ' + cardsIn(scope).length + ' 张卡（Markdown）');
    }
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { }
      t.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };

  function key(e) { if (e.key === 'Escape') { e.preventDefault(); closeStoryView(); } }
  function closeStoryView() {
    var el = document.getElementById('storyView');
    if (el) el.remove();
    document.removeEventListener('keydown', key, true);
  }
  window.closeStoryView = closeStoryView;

  window.openStoryView = function (sid, startView) {
    closeStoryView();
    scope = sid || 'main';
    view = startView || (scope === '*' ? 'time' : 'role');
    var all = (scope === '*');
    var layer = document.createElement('div');
    layer.id = 'storyView'; layer.className = 'roleView';
    layer.innerHTML = '<div class="rvBox" style="width:min(1040px,100%)">' +
      '<div class="rvHead"><b class="rvDot role-hq"></b><strong>用户故事拆卡 · ' +
        esc(scopeLabel(scope)) + '</strong>' +
        '<span>' + cardsIn(scope).length + ' 张卡</span>' +
        '<button type="button" class="rvClose" onclick="closeStoryView()" title="关闭（Esc）">\u00d7</button></div>' +
      '<div class="svHint">先看<b>时间线总览</b>：12 个模块各要多少人天、按依赖顺序排下来大概多久；' +
        '点模块名展开里面的场景，再点场景看具体的卡。<br>' +
        '一张卡＝一个可独立验收的行为。层级：<b>角色 Role</b> → <b>史诗 Epic</b>（能力级，横跨多张卡）→ ' +
        '<b>故事 Story</b>（这张卡）。估算是 BA 初估，点数由开发团队在 Sprint Planning 校准。</div>' +
      '<div class="svTools">' +
        VIEWS.map(function (v) {
          return '<button type="button" class="svTab" data-v="' + v[0] +
            '" onclick="storyViewTab(\'' + v[0] + '\')">' + v[1] + '</button>';
        }).join('') +
        '<span class="svSpacer"></span>' +
        (all ? '' : '<button type="button" class="svTab" onclick="openStoryView(\'*\',\'role\')">看全部场景的卡</button>') +
        '<button type="button" class="svTab" onclick="storyViewCopy()">复制为 Markdown</button>' +
      '</div>' +
      '<div class="svStat"></div>' +
      '<div class="rvBody" style="max-height:60vh"></div></div>';
    layer.addEventListener('click', function (e) { if (e.target === layer) closeStoryView(); });
    document.body.appendChild(layer);
    document.addEventListener('keydown', key, true);
    paint();
  };

  window.storyViewGo = function (sid, i) {
    closeStoryView();
    try {
      if (typeof renderSingleScenario === 'function') renderSingleScenario(sid);
      if (typeof showSingleStep === 'function') showSingleStep(i);
      var node = document.querySelector('.swimNode[data-step="' + i + '"]');
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (e) { }
  };

  /* 入口：挂在服务蓝图标题栏的右上角。按钮上直接写这张图的卡数与人天。 */
  function mount(sid) {
    var head = document.querySelector('#flowContent .swimHeading');
    if (!head) return;
    Array.prototype.forEach.call(document.querySelectorAll('.svEntry'), function (e) { e.remove(); });
    var s = sum(cardsOf(sid));
    var wrap = document.createElement('div');
    wrap.className = 'svEntry noTextEdit';
    wrap.innerHTML =
      '<button type="button" class="svBtn" onclick="openStoryView(\'' + sid + '\',\'role\')"' +
        ' title="按 角色 / Epic / Story 看这张流程图拆出来的用户故事卡，含设计与开发初估">' +
        '用户故事拆卡 <b>' + s.n + '</b> 张 <em>' + n1(s.dz + s.dv) + ' 人天</em></button>' +
      '<button type="button" class="svBtn svGhost" onclick="openStoryView(\'*\',\'time\')"' +
        ' title="全部模块的排期总览与故事卡">时间线总览</button>';
    head.style.position = 'relative';
    head.style.paddingRight = '300px';
    head.appendChild(wrap);
  }

  if (typeof renderSingleScenario === 'function') {
    var prev = renderSingleScenario;
    renderSingleScenario = function (id) {
      prev.apply(this, arguments);
      try { mount(id); } catch (e) { console.warn('故事卡入口挂载失败', e); }
    };
    window.renderSingleScenario = renderSingleScenario;
    try { renderSingleScenario(typeof activeScenario === 'string' ? activeScenario : 'main'); }
    catch (e) { }
  }
})();
