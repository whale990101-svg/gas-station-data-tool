import { buildStations, compact, dateText, downloadCsv, fuels, numberText, parseCsv, regionOptions, selection } from "./data.js";
import { StationMap, boundariesFor, loadBoundaries } from "./map.js";
import { isStandalone, readAsset } from "./platform.js";

const home = document.querySelector("#home");
const workspace = document.querySelector("#workspace");
const form = document.querySelector("#form");
const results = document.querySelector("#results");
const title = document.querySelector("#workspace-title");
const labels = { extract: "지역별 CSV 추출", lookup: "주유소 지도·가격 조회" };
const sort = (a, b) => a.localeCompare(b, "ko");
const by = (node, selector) => node.querySelector(selector);
let activeWorkspace;

function openWorkspace() {
  if (activeWorkspace) {
    activeWorkspace.map?.dispose();
    activeWorkspace.map = null;
    Object.values(activeWorkspace.workers).forEach(job => job.terminate());
    activeWorkspace.workers = {};
  }
  form.replaceChildren();
  results.replaceChildren();
  results.hidden = true;
  const mode = isStandalone ? location.hash.slice(1) : location.pathname.slice(1);
  const open = Object.hasOwn(labels, mode);
  home.hidden = open;
  workspace.hidden = !open;
  activeWorkspace = null;
  if (!open) return;

  title.textContent = labels[mode];
  title.focus();
  form.append(document.querySelector("#form-template").content.cloneNode(true));
  const current = { mode, files: {}, workers: {}, province: by(form, '[data-region="province"]'),
    district: by(form, '[data-region="district"]'), summary: by(form, "[data-summary]") };
  activeWorkspace = current;
  const kinds = ["location", "price"];
  for (const kind of kinds) {
    const input = by(form, '[data-file="' + kind + '"]');
    const status = by(form, '[data-status="' + kind + '"]');
    input.addEventListener("change", () => upload(current, kind, input.files[0], status));
  }
  by(form, "[data-source]").addEventListener("click", () => {
    for (const kind of kinds) {
      by(form, '[data-file="' + kind + '"]').value = "";
      upload(current, kind, "/source/" + kind + ".csv", by(form, '[data-status="' + kind + '"]'));
    }
  });
  current.province.addEventListener("change", () => { showDistricts(current); showSelection(current); });
  current.district.addEventListener("change", () => showSelection(current));
  updateOptions(current);
}

function upload(current, kind, source, status) {
  current.workers[kind]?.terminate();
  delete current.files[kind];
  status.dataset.error = "false";
  status.textContent = source ? "CSV를 읽는 중입니다…" : "";
  updateOptions(current);
  if (!source) return;

  const job = isStandalone ? { terminate() {} } : new Worker("./worker.js", { type: "module" });
  current.workers[kind] = job;
  const finish = ({ result, error }) => {
    if (current.workers[kind] !== job) return;
    job.terminate();
    delete current.workers[kind];
    if (error) {
      status.dataset.error = "true";
      status.textContent = error;
    } else {
      current.files[kind] = result;
      const fromFolder = typeof source === "string" ? "기본 파일 · " : "";
      const notes = [fromFolder + numberText(result.rows.length) + "행"];
      if (result.unknown) notes.push("지역 미확인 " + numberText(result.unknown) + "행");
      if (result.malformed) notes.push("열 개수 오류 " + numberText(result.malformed) + "행");
      if (result.unviewable) notes.push("가격 조회 불가 " + numberText(result.unviewable) + "행");
      status.textContent = notes.join(" · ");
    }
    updateOptions(current);
  };
  if (isStandalone) {
    Promise.resolve(typeof source === "string" ? readAsset(source, kind) : source)
      .then(input => input.arrayBuffer())
      .then(buffer => finish({ result: parseCsv(buffer, kind) }))
      .catch(error => finish({ error: error.message }));
  } else {
    job.onmessage = event => finish(event.data);
    job.onerror = () => finish({ error: "파일을 읽을 수 없습니다. 파일을 다시 선택하세요." });
    job.postMessage({ source, kind });
  }
}

function replaceOptions(select, prompt, items) {
  select.replaceChildren(new Option(prompt, ""), ...items.map(([value, label]) => new Option(label, value)));
}

function updateOptions(current) {
  const previousProvince = current.province.value;
  const previousDistrict = current.district.value;
  const ready = current.files.location && current.files.price;
  if (ready) current.options = regionOptions(current.files);
  const provinces = ready ? [...current.options.keys()].sort(sort) : [];
  replaceOptions(current.province, "시도를 선택하세요", provinces.map(name => [name, name]));
  current.province.disabled = !provinces.length;
  if (provinces.includes(previousProvince)) current.province.value = previousProvince;
  else if (provinces.length === 1) current.province.value = provinces[0];
  showDistricts(current);
  if ([...current.district.options].some(option => option.value === previousDistrict)) {
    current.district.value = previousDistrict;
  }
  current.summary.textContent = !ready ? "두 CSV를 업로드하면 지역을 선택할 수 있습니다." :
    provinces.length ? "시도와 시·군·구를 선택하세요." : "두 CSV에서 선택할 수 있는 지역이 없습니다.";
  showSelection(current);
}

function showDistricts(current) {
  const districts = current.options?.get(current.province.value);
  const entries = [...(districts ?? [])].sort((a, b) => sort(a[1], b[1]));
  replaceOptions(current.district, "시도 전체", entries);
  current.district.disabled = !districts;
}

function showSelection(current) {
  current.map?.dispose();
  current.map = null;
  results.replaceChildren();
  const province = current.province.value;
  const district = current.district.value;
  results.hidden = !province;
  if (!province) {
    if (!current.province.disabled) current.summary.textContent = "시도와 시·군·구를 선택하세요.";
    return;
  }

  const selected = Object.fromEntries(Object.entries(current.files).map(([kind, file]) => [kind, selection(file, province, district)]));
  current.summary.textContent = "주유소 위치 " + numberText(selected.location.length) + "건 · 판매가격 " + numberText(selected.price.length) + "건";
  if (current.mode === "extract") {
    showDownloads(current, selected, province, district);
  } else {
    showMap(current, selected, province, district);
  }
}

function showDownloads(current, selected, province, district) {
  results.innerHTML = '<div class="downloads"></div>';
  const area = district && district !== province ? province + "_" + district : province;
  for (const [kind, name] of [["location", "주유소"], ["price", "판매가격"]]) {
    const panel = document.createElement("section");
    panel.className = "panel";
    const label = document.createElement("h2");
    label.textContent = name + " CSV";
    const count = document.createElement("p");
    count.textContent = numberText(selected[kind].length) + "건";
    const button = document.createElement("button");
    button.className = "button";
    button.textContent = name + " CSV 저장";
    button.addEventListener("click", () => downloadCsv(current.files[kind], selected[kind], area + "_" + name + ".csv"));
    panel.append(label, count, button);
    results.firstElementChild.append(panel);
  }
}

function showMap(current, selected, province, district) {
  results.innerHTML = `
    <div class="lookup-grid">
      <section class="panel map-panel" aria-labelledby="map-title">
        <h2 id="map-title">주유소 지도</h2>
        <p class="status" data-map-status role="status">로컬 지도 경계를 읽는 중입니다…</p>
        <div class="map-surface">
          <canvas aria-label="행정동 경계와 주유소 마커">주유소 목록에서 가격을 조회할 수 있습니다.</canvas>
          <div class="map-buttons">
            <button type="button" data-zoom-in aria-label="지도 확대">+</button>
            <button type="button" data-zoom-out aria-label="지도 축소">−</button>
            <button type="button" data-fit aria-label="선택 지역 전체 보기">전체</button>
          </div>
        </div>
      </section>
      <section class="panel station-panel" aria-labelledby="list-title">
        <h2 id="list-title">주유소 목록</h2>
        <input type="search" aria-label="주유소명 또는 주소 검색" placeholder="주유소명 또는 주소 검색">
        <div class="station-list" aria-label="검색 결과"></div>
        <div class="list-nav" hidden>
          <button type="button" data-prev>이전</button>
          <span class="secondary" data-page></span>
          <button type="button" data-next>다음</button>
        </div>
        <div class="detail" aria-live="polite"><p class="secondary">지도나 목록에서 주유소를 선택하세요.</p></div>
      </section>
    </div>`;
  const stations = buildStations(current.files, selected);
  const stationIndex = new Map(stations.map(station => [station.key, station]));
  const search = by(results, 'input[type="search"]');
  const list = by(results, ".station-list");
  const nav = by(results, ".list-nav");
  const detail = by(results, ".detail");
  const mapStatus = by(results, "[data-map-status]");
  const previous = by(nav, "[data-prev]");
  const next = by(nav, "[data-next]");
  const pageSize = 60;
  let page = 0;
  let active = "";
  const matches = station => compact(station.name + " " + station.address).toLowerCase();

  function renderList(scrollToSelection = false) {
    const query = compact(search.value).toLowerCase();
    const filtered = stations.filter(station => matches(station).includes(query));
    if (scrollToSelection) {
      const index = filtered.findIndex(station => station.key === active);
      if (index >= 0) page = Math.floor(index / pageSize);
    }
    const start = page * pageSize;
    const end = Math.min(start + pageSize, filtered.length);
    nav.hidden = filtered.length <= pageSize;
    previous.disabled = !page;
    next.disabled = end >= filtered.length;
    by(nav, "[data-page]").textContent = numberText(start + 1) + "–" + numberText(end) + " / " + numberText(filtered.length);
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "secondary";
      empty.textContent = stations.length ? "검색 결과가 없습니다." : "선택 지역의 주유소 자료가 없습니다.";
      list.append(empty);
    }
    for (const station of filtered.slice(start, end)) {
      const button = document.createElement("button");
      const name = document.createElement("span");
      const address = document.createElement("span");
      name.textContent = station.name || "이름 정보 없음";
      address.textContent = station.address || "주소 정보 없음";
      address.className = "secondary";
      button.dataset.station = station.key;
      button.setAttribute("aria-pressed", String(station.key === active));
      button.append(name, address);
      button.addEventListener("click", () => choose(station.key));
      list.append(button);
    }
    if (scrollToSelection) {
      const selectedButton = by(list, '[aria-pressed="true"]');
      if (selectedButton) list.scrollTop = selectedButton.offsetTop - list.offsetTop;
    } else {
      list.scrollTop = 0;
    }
  }

  function choose(key) {
    const station = stationIndex.get(key);
    active = key;
    map.select(station);
    for (const button of list.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.station === key));
    }
    if (!by(list, '[aria-pressed="true"]')) renderList(true);
    showPrice(detail, station);
  }

  const map = new StationMap(by(results, "canvas"), choose);
  current.map = map;
  by(results, "[data-zoom-in]").addEventListener("click", () => map.zoom(1.4));
  by(results, "[data-zoom-out]").addEventListener("click", () => map.zoom(1 / 1.4));
  by(results, "[data-fit]").addEventListener("click", () => map.fit());
  search.addEventListener("input", () => { page = 0; renderList(); });
  previous.addEventListener("click", () => { page--; renderList(); });
  next.addEventListener("click", () => { page++; renderList(); });
  renderList();

  const counts = "마커 " + numberText(stations.filter(station => station.point).length) + "개 · 가격이 연결된 마커 " +
    numberText(stations.filter(station => station.point && station.observations.length).length) + "개";
  map.setData([], stations);
  loadBoundaries().then(features => {
    if (current.map !== map) return;
    const shapes = boundariesFor(features, province, district);
    map.setData(shapes, stations);
    mapStatus.textContent = (shapes.length ? "행정동 경계 " + numberText(shapes.length) + "개" :
      "선택 지역의 행정동 경계가 없습니다.") + " · " + counts;
  }).catch(() => {
    if (current.map !== map) return;
    mapStatus.textContent = "로컬 지도 파일을 읽을 수 없습니다. · " + counts;
  });
}

function showPrice(detail, station) {
  detail.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = station.name || "이름 정보 없음";
  const address = document.createElement("p");
  address.className = "secondary";
  address.textContent = station.address || "주소 정보 없음";
  const metadata = document.createElement("p");
  metadata.className = "secondary";
  detail.append(heading, address, metadata);
  if (!station.point) {
    const message = document.createElement("p");
    message.className = "secondary";
    message.textContent = "유효한 좌표가 없어 지도에 표시할 수 없습니다.";
    detail.append(message);
  }
  if (!station.observations.length) {
    metadata.textContent = station.brand;
    const message = document.createElement("p");
    message.textContent = station.message;
    detail.append(message);
    return;
  }

  const dateLabel = document.createElement("label");
  dateLabel.textContent = "관측일";
  const dates = document.createElement("select");
  dates.replaceChildren(...station.observations.map((row, index) => new Option(dateText(row.date), String(index))));
  dateLabel.append(dates);
  const table = document.createElement("table");
  table.className = "price-table";
  const caption = table.createCaption();
  caption.textContent = "유종별 판매가격";
  const body = table.createTBody();
  const cells = fuels.map(fuel => {
    const row = body.insertRow();
    const header = document.createElement("th");
    header.scope = "row";
    header.textContent = fuel;
    row.append(header);
    return row.insertCell();
  });
  function renderPrices() {
    const row = station.observations[Number(dates.value)];
    metadata.textContent = [row.brand || station.brand, row.self].filter(Boolean).join(" · ");
    row.fuels.forEach((value, index) => {
      const price = Number(value.replaceAll(",", ""));
      cells[index].textContent = Number.isFinite(price) && price > 0 ? numberText(price) + "원/L" : "가격 정보 없음";
    });
  }
  dates.addEventListener("change", renderPrices);
  detail.append(dateLabel, table);
  renderPrices();
}

if (isStandalone) window.addEventListener("hashchange", openWorkspace);
openWorkspace();
