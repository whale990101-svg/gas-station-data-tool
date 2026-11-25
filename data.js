export const fuels = ["고급휘발유", "휘발유", "경유", "실내등유"];

const schemas = {
  location: ["주유소명", "시도명", "시군구명", "소재지도로명주소", "소재지지번주소", "전화번호", "위도", "경도", "상표구분명", "대표자명", "총직원수", "데이터기준일자", "제공기관코드", "제공기관명"],
  price: ["번호", "지역", "상호", "주소", "기간", "상표", "셀프여부", ...fuels],
};

const mergedProvince = "전남광주통합특별시";
const oldJeonnam = new Set("목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군".split(" "));
const oldGwangju = new Set("동구 서구 남구 북구 광산구".split(" "));
const sejong = "세종특별자치시";
const provinces = new Map([
  ["서울특별시", "서울 서울시"], ["부산광역시", "부산 부산시"], ["대구광역시", "대구 대구시"],
  ["인천광역시", "인천 인천시"], ["대전광역시", "대전 대전시"], ["울산광역시", "울산 울산시"],
  [sejong, "세종 세종시"], ["경기도", "경기"], ["강원특별자치도", "강원 강원도"],
  ["충청북도", "충북"], ["충청남도", "충남"], ["전북특별자치도", "전북 전라북도"],
  ["경상북도", "경북"], ["경상남도", "경남"], ["제주특별자치도", "제주 제주도"],
  [mergedProvince, "전남광주"], ["전라남도", "전남"], ["광주광역시", "광주 광주시"],
].flatMap(([name, aliases]) => [name, ...aliases.split(" ")].map(alias => [alias, name])));
const provincePrefixes = [...provinces.keys()].sort((a, b) => b.length - a.length);
const count = new Intl.NumberFormat("ko-KR");
export const numberText = value => count.format(value);
export const compact = value => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
const words = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const validDate = value => {
  if (!/^\d{8}$/.test(value)) return false;
  const iso = dateText(value);
  const date = new Date(iso);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === iso;
};
export const dateText = value => value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
      continue;
    }
    if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (char !== ",") {
        rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (char === '"' && !field && !closed) {
      quoted = true;
    } else if (char === '"' || closed) {
      throw new Error("CSV 따옴표 형식이 올바르지 않습니다.");
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV에서 닫히지 않은 따옴표가 있습니다.");
  if (row.length || field || closed) rows.push([...row, field]);
  return rows.filter(cells => cells.some(cell => cell.trim()));
}

export function parseCsv(buffer, kind) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      text = new TextDecoder("euc-kr", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("CP949 또는 UTF-8 CSV로 저장한 뒤 다시 업로드하세요.");
    }
  }
  const [headers, ...sourceRows] = csvRows(text);
  if (!headers) throw new Error("파일에 CSV 헤더가 없습니다.");
  const columns = headers.map(header => header.trim());
  const missing = schemas[kind].filter(name => !columns.includes(name));
  if (missing.length) throw new Error("필수 열이 없습니다. " + missing.join(", "));
  if (new Set(columns).size !== columns.length) throw new Error("이름이 중복된 열이 있습니다.");

  const indexes = Object.fromEntries(columns.map((name, index) => [name, index]));
  const rows = [];
  const records = [];
  let malformed = 0;
  let unknown = 0;
  let unviewable = 0;
  for (const row of sourceRows) {
    if (kind === "price" && /^기준\s*[:：]/.test(row[0].trim()) && row.slice(1).every(value => !value.trim())) continue;
    if (row.length !== headers.length) { malformed++; continue; }
    const get = name => row[indexes[name]].trim();
    const place = kind === "location"
      ? region(get("시도명"), get("시군구명"))
      : priceRegion(get("지역"), get("주소"));
    if (!place) unknown++;
    const date = kind === "price" ? get("기간") : "";
    const id = kind === "price" ? get("번호") : "";
    const viewable = kind === "location" || Boolean(id && validDate(date) && get("상호"));
    if (!viewable) unviewable++;
    records.push({ place, viewable, id, date });
    rows.push(row);
  }
  return { headers, rows, indexes, records, malformed, unknown, unviewable };
}

function provincePrefix(value) {
  const text = words(value);
  const spaced = text.split(" ")[0];
  if (provinces.has(spaced)) return [spaced, text.slice(spaced.length).trim()];
  // Full names also occur without a space before the city in the source addresses.
  const prefix = provincePrefixes.find(key => key.length >= 4 && text.startsWith(key));
  return prefix ? [prefix, text.slice(prefix.length).trim()] : ["", text];
}

function mergedName(province, district) {
  if (province === "전라남도" && oldJeonnam.has(district)) return mergedProvince;
  if (province === "광주광역시" && oldGwangju.has(district)) return mergedProvince;
  return province;
}

export function region(provinceValue, districtValue) {
  const name = provinces.get(compact(provinceValue));
  if (!name) return null;
  const district = compact(districtValue);
  if (name === sejong) return { province: sejong, district: sejong, city: sejong };
  if (!district || !/^[가-힣]+[시군구]$/.test(district)) return null;
  const city = /^(.*시)[가-힣]+구$/.exec(district)?.[1] ?? district;
  return { province: mergedName(name, district), district, city };
}

function priceRegion(label, address) {
  const [province, district] = provincePrefix(label);
  const place = region(province, district);
  if (!place || !place.district.endsWith("시") || place.province === sejong) return place;
  const addressBody = provincePrefix(address)[1];
  const detail = new RegExp("^" + place.city + "\\s*([가-힣]+구)(?:\\s|$)").exec(addressBody);
  return detail ? region(place.province, place.city + detail[1]) : place;
}

export function regionOptions(files) {
  const options = new Map();
  for (const file of Object.values(files)) {
    for (const { place } of file.records) {
      if (!place) continue;
      if (!options.has(place.province)) options.set(place.province, new Map());
      const districts = options.get(place.province);
      districts.set(place.city, place.city);
      if (place.city !== place.district) {
        districts.set(place.district, place.city + " " + place.district.slice(place.city.length));
      }
    }
  }
  return options;
}

export function inRegion(place, province, district) {
  return Boolean(place && place.province === province &&
    (!district || place.district === district || place.city === district));
}

export function selection(file, province, district) {
  const result = [];
  file.records.forEach(({ place }, index) => {
    if (inRegion(place, province, district)) result.push(index);
  });
  return result;
}

export function downloadCsv(file, indices, filename) {
  const line = row => row.map(cell => /[",\r\n]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell).join(",");
  const text = [line(file.headers), ...indices.map(index => line(file.rows[index]))].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getValue(file, index, name) {
  return file.rows[index][file.indexes[name]].trim();
}

function stationName(name) {
  return compact(name).replace(/\(주\)|주식회사/g, "").toLowerCase();
}

function addressKeys(value, place) {
  if (!value) return [];
  const [, rest] = provincePrefix(value);
  const address = compact(rest).replace(/[‐‑–−]/g, "-").toLowerCase();
  if (!address) return [];
  const districtAddress = address.startsWith(place.district)
    ? address : place.district + address;
  const keys = [districtAddress];
  if (place.city !== place.district && address.startsWith(place.city) && !address.startsWith(place.district)) {
    keys[0] = place.district + address.slice(place.city.length);
  }
  // A citywide record can omit its administrative ward. Compare the city and
  // street address too, and reject duplicate candidates in either direction.
  if (place.city !== place.district && place.district.endsWith("구")) {
    keys.push(place.city + keys[0].slice(place.district.length));
  }
  return keys;
}

function stationKeys(name, addresses, place) {
  const normalized = stationName(name);
  if (!normalized) return [];
  return addresses.flatMap(address => addressKeys(address, place))
    .map(address => [place.province, place.city, normalized, address].join("\0"));
}

function coordinate(latText, lonText) {
  if (!latText || !lonText) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 33 && lat <= 39.5 && lon >= 124 && lon <= 132
    ? [lon, lat] : null;
}

export function buildStations(files, selected) {
  const history = new Map();
  const priceIndex = new Map();
  for (const index of selected.price) {
    const { place, viewable, id, date } = files.price.records[index];
    if (!viewable) continue;
    const get = name => getValue(files.price, index, name);
    const name = get("상호");
    const address = get("주소");
    if (!history.has(id)) history.set(id, []);
    history.get(id).push({ date, name, address, brand: get("상표"), self: get("셀프여부"),
      fuels: fuels.map(get) });
    for (const key of stationKeys(name, [address], place)) {
      if (!priceIndex.has(key)) priceIndex.set(key, new Map());
      priceIndex.get(key).set(id, place);
    }
  }
  for (const observations of history.values()) observations.sort((a, b) => b.date.localeCompare(a.date));

  const claims = new Map();
  const located = selected.location.map(index => {
    const get = name => getValue(files.location, index, name);
    const name = get("주유소명");
    const addresses = [get("소재지도로명주소"), get("소재지지번주소")].filter(Boolean);
    const place = files.location.records[index].place;
    const candidates = new Set();
    for (const key of stationKeys(name, addresses, place)) {
      for (const [id, other] of priceIndex.get(key) ?? []) {
        if (place.district === other.district || place.district === place.city || other.district === other.city) {
          candidates.add(id);
        }
      }
    }
    for (const id of candidates) claims.set(id, (claims.get(id) ?? 0) + 1);
    return { name, address: addresses[0] ?? "", brand: get("상표구분명"), candidates,
      point: coordinate(get("위도"), get("경도")), key: "location-" + index };
  });

  const linked = new Set();
  const stations = located.map(({ candidates, ...station }) => {
    const [id] = candidates;
    const matched = candidates.size === 1 && claims.get(id) === 1;
    if (matched) linked.add(id);
    const message = matched ? "" : candidates.size ? "가격 연결 후보가 여러 개입니다." : "일치하는 판매가격 자료가 없습니다.";
    return { ...station, observations: matched ? history.get(id) : [], message };
  });
  for (const [id, observations] of history) {
    if (linked.has(id)) continue;
    const { name, address, brand } = observations[0];
    stations.push({ key: "price-" + id, name, address, brand, point: null, observations });
  }
  return stations.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.address.localeCompare(b.address, "ko"));
}
