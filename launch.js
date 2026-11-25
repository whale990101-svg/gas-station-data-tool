if (location.protocol === "file:") {
  location.replace(new URL("./offline.html" + location.hash, location.href));
} else {
  import("./app.js");
}
