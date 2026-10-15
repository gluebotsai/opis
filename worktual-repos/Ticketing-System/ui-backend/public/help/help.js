(function () {
  function pathParts() {
    var parts = location.pathname.split("/").filter(Boolean);
    // /hc/:slug or /hc/:slug/a/:articleId
    if (parts[0] !== "hc" || !parts[1]) return { slug: null, articleId: null };
    return {
      slug: decodeURIComponent(parts[1]),
      articleId: parts[2] === "a" && parts[3] ? decodeURIComponent(parts[3]) : null,
    };
  }

  var route = pathParts();
  var slug = route.slug;
  var category = "All";
  var titleEl = document.getElementById("title");
  var orgEl = document.getElementById("org-name");
  var statusEl = document.getElementById("status");
  var resultsEl = document.getElementById("results");
  var listView = document.getElementById("list-view");
  var articleView = document.getElementById("article-view");
  var catsEl = document.getElementById("categories");
  var qInput = document.getElementById("q");
  var form = document.getElementById("search-form");
  var backBtn = document.getElementById("back");

  function showStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadMeta() {
    var res = await fetch("/api/public/help/" + encodeURIComponent(slug));
    if (!res.ok) throw new Error("Help center not found");
    var data = await res.json();
    document.title = (data.title || "Help Center") + " · Help";
    titleEl.textContent = data.title || "Help Center";
    orgEl.textContent = data.organizationName || "Help Center";
    if (data.categories && data.categories.length) {
      catsEl.hidden = false;
      catsEl.innerHTML = "";
      ["All"].concat(data.categories).forEach(function (c) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = c;
        btn.className = c === category ? "active" : "";
        btn.addEventListener("click", function () {
          category = c;
          Array.prototype.forEach.call(catsEl.children, function (el) {
            el.classList.toggle("active", el.textContent === category);
          });
          loadList();
        });
        catsEl.appendChild(btn);
      });
    }
  }

  async function loadList() {
    listView.hidden = false;
    articleView.hidden = true;
    showStatus("");
    var q = (qInput.value || "").trim();
    var url =
      "/api/public/help/" +
      encodeURIComponent(slug) +
      "/articles?q=" +
      encodeURIComponent(q) +
      "&category=" +
      encodeURIComponent(category);
    var res = await fetch(url);
    if (!res.ok) {
      showStatus("Could not load articles.");
      return;
    }
    var data = await res.json();
    var articles = data.articles || [];
    if (!articles.length) {
      resultsEl.innerHTML = '<li class="empty">No published articles yet.</li>';
      return;
    }
    resultsEl.innerHTML = articles
      .map(function (a) {
        var href = "/hc/" + encodeURIComponent(slug) + "/a/" + encodeURIComponent(a.id);
        return (
          '<li><a href="' +
          href +
          '"><span class="cat">' +
          escapeHtml(a.category) +
          "</span><h3>" +
          escapeHtml(a.title) +
          "</h3><p>" +
          escapeHtml(a.excerpt || "") +
          "</p></a></li>"
        );
      })
      .join("");
  }

  async function loadArticle(articleId) {
    listView.hidden = true;
    articleView.hidden = false;
    showStatus("");
    var res = await fetch(
      "/api/public/help/" +
        encodeURIComponent(slug) +
        "/articles/" +
        encodeURIComponent(articleId)
    );
    if (!res.ok) {
      showStatus("Article not found.");
      listView.hidden = false;
      articleView.hidden = true;
      return;
    }
    var a = await res.json();
    document.getElementById("article-meta").textContent = a.category || "General";
    document.getElementById("article-title").textContent = a.title || "Untitled";
    document.getElementById("article-body").textContent = a.content || "";
    document.title = (a.title || "Article") + " · Help";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (route.articleId) {
      history.pushState({}, "", "/hc/" + encodeURIComponent(slug));
      route.articleId = null;
    }
    loadList();
  });

  var searchTimer;
  if (qInput) {
    qInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadList, qInput.value.trim() ? 250 : 0);
    });
  }

  backBtn.addEventListener("click", function () {
    history.pushState({}, "", "/hc/" + encodeURIComponent(slug));
    route.articleId = null;
    loadList();
  });

  window.addEventListener("popstate", function () {
    route = pathParts();
    if (route.articleId) loadArticle(route.articleId);
    else loadList();
  });

  if (!slug) {
    showStatus("Missing help center address.");
    return;
  }

  loadMeta()
    .then(function () {
      if (route.articleId) return loadArticle(route.articleId);
      return loadList();
    })
    .catch(function () {
      showStatus("This help center could not be found.");
      listView.hidden = true;
    });
})();
