import { inRegion, region } from "./data.js";
import { readAsset } from "./platform.js";

const mapFile = "./전국주유소표준데이터/HangJeongDong_ver20261001.geojson";
const project = ([lon, lat]) => [lon, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI];
let cachedBoundaries;

export function loadBoundaries() {
  if (!cachedBoundaries) {
    cachedBoundaries = readAsset(mapFile, "map").then(async response => {
      if (!response.ok) throw new Error("로컬 지도 파일을 읽을 수 없습니다.");
      const data = await response.json();
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("지도 파일 형식이 올바르지 않습니다.");
      return data.features.map(({ geometry, properties }) => ({
        place: region(properties.sidonm, properties.sggnm),
        polygons: geometry?.type === "Polygon" ? [geometry.coordinates] :
          geometry?.type === "MultiPolygon" ? geometry.coordinates : [],
      }));
    }).catch(error => {
      cachedBoundaries = undefined;
      throw error;
    });
  }
  return cachedBoundaries;
}

export function boundariesFor(features, province, district) {
  return features.filter(feature => inRegion(feature.place, province, district));
}

export class StationMap {
  constructor(canvas, choose) {
    this.canvas = canvas;
    this.choose = choose;
    this.context = canvas.getContext("2d");
    this.paths = [];
    this.points = [];
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.center = project([127.8, 36.4]);
    this.drag = null;
    this.selected = "";
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      this.zoom(event.deltaY < 0 ? 1.24 : 1 / 1.24, this.position(event));
    }, { passive: false });
    canvas.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0) return;
      this.drag = { id: event.pointerId, point: this.position(event), center: [...this.center], moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (this.drag?.id !== event.pointerId) return;
      const [x, y] = this.position(event);
      const dx = x - this.drag.point[0];
      const dy = y - this.drag.point[1];
      if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
      if (!this.drag.moved) return;
      this.center = [this.drag.center[0] - dx / this.scale, this.drag.center[1] - dy / this.scale];
      this.draw();
    });
    canvas.addEventListener("pointerup", event => {
      if (this.drag?.id !== event.pointerId) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (!moved) this.pick(this.position(event));
    });
    canvas.addEventListener("pointercancel", () => { this.drag = null; });
    canvas.addEventListener("lostpointercapture", () => { this.drag = null; });
  }

  dispose() {
    this.observer.disconnect();
  }

  position(event) {
    const box = this.canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const first = !this.width;
    this.width = width;
    this.height = height;
    this.ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
    if (first) this.fit();
    else this.draw();
  }

  setData(features, stations) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const include = ([x, y]) => {
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
      return [x, y];
    };
    this.paths = features.map(feature => {
      const path = new Path2D();
      for (const polygon of feature.polygons) {
        for (const ring of polygon) {
          ring.forEach((position, index) => {
            const [x, y] = include(project(position));
            if (index === 0) path.moveTo(x, y);
            else path.lineTo(x, y);
          });
          path.closePath();
        }
      }
      return path;
    });
    this.points = stations.filter(station => station.point).map(station => ({
      key: station.key, xy: include(project(station.point)), linked: station.observations.length > 0,
    }));
    this.bounds = Number.isFinite(bounds[0]) ? bounds : [124.8, -42, 131.3, -34.7];
    this.fit();
  }

  fit() {
    if (!this.width || !this.bounds) return;
    const [x1, y1, x2, y2] = this.bounds;
    this.center = [(x1 + x2) / 2, (y1 + y2) / 2];
    this.scale = Math.min((this.width - 48) / Math.max(.015, x2 - x1),
      (this.height - 48) / Math.max(.015, y2 - y1));
    this.draw();
  }

  zoom(factor, position = [this.width / 2, this.height / 2]) {
    const oldScale = this.scale;
    this.scale = Math.min(1e6, Math.max(8, this.scale * factor));
    const ratio = 1 / oldScale - 1 / this.scale;
    this.center[0] += (position[0] - this.width / 2) * ratio;
    this.center[1] += (position[1] - this.height / 2) * ratio;
    this.draw();
  }

  screen([x, y]) {
    return [(x - this.center[0]) * this.scale + this.width / 2,
      (y - this.center[1]) * this.scale + this.height / 2];
  }

  pick([x, y]) {
    let nearest;
    let distance = 12;
    for (const point of this.points) {
      const [px, py] = this.screen(point.xy);
      const next = Math.hypot(px - x, py - y);
      if (next > distance) continue;
      nearest = point;
      distance = next;
    }
    if (nearest) this.choose(nearest.key);
  }

  select(station) {
    this.selected = station.key;
    if (station.point) {
      const xy = project(station.point);
      const [x, y] = this.screen(xy);
      if (x < 12 || x > this.width - 12 || y < 12 || y > this.height - 12) this.center = xy;
    }
    this.draw();
  }

  draw() {
    if (!this.width) return;
    const ctx = this.context;
    const [left, top] = this.screen([0, 0]);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(this.scale, this.scale);
    ctx.fillStyle = "#f6f6f6";
    ctx.strokeStyle = "#8e8e8e";
    ctx.lineWidth = .8 / this.scale;
    for (const path of this.paths) {
      ctx.fill(path, "evenodd");
      ctx.stroke(path);
    }
    ctx.restore();

    const marker = point => {
      const [x, y] = this.screen(point.xy);
      const selected = point.key === this.selected;
      if (x < -10 || x > this.width + 10 || y < -10 || y > this.height + 10) return;
      ctx.beginPath();
      ctx.arc(x, y, selected ? 8 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "#fe7023" : point.linked ? "#9b3500" : "#535353";
      ctx.fill();
      ctx.strokeStyle = selected ? "#1b1b1b" : "#f6f6f6";
      ctx.lineWidth = selected ? 2 : 1.25;
      ctx.stroke();
    };
    this.points.filter(point => point.key !== this.selected).forEach(marker);
    const selected = this.points.find(point => point.key === this.selected);
    if (selected) marker(selected);
  }
}
