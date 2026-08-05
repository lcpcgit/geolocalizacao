const COOKIE_NAME = "sessao_usuario";
const COOKIE_VALUE = "acesso_liberado_ok";
const APP_VERSION_FALLBACK = "20260805-apoio-prefeito";

const CAMPOS_IDENTIFICACAO = ["nome", "moradores_casa", "povoado_bairro", "endereco_rua", "numero"];
const CAMPOS_PESQUISA = [
  "ocupacao",
  "religiao",
  "governo_lula",
  "governo_brandao",
  "governo_dino_penha",
  "voto_presidente",
  "voto_governador",
  "voto_deputado_estadual",
  "voto_deputado_federal",
  "influencia_apoio_prefeito",
  "aprova_saude_municipio",
  "aprova_educacao_municipio",
  "aprova_infraestrutura_municipio"
];
const DEMANDAS = ["Água", "Estrada", "Escola", "Posto de Saúde", "Praça", "Iluminação Pública", "Pavimentação"];
const LIMITES_BRASIL = {
  minLat: -34,
  maxLat: 6,
  minLng: -74,
  maxLng: -34
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const exigirSenha = passwordRequired(env);

    if (path === "/") {
      return redirect(`/static/index.html?v=${env.APP_VERSION || APP_VERSION_FALLBACK}`);
    }

    if (path === "/login" && request.method === "GET") {
      if (!exigirSenha) return redirect(`/static/index.html?v=${env.APP_VERSION || APP_VERSION_FALLBACK}`);
      return loginPage(false);
    }
    if (path === "/autenticar" && request.method === "POST") return autenticar(request, env);

    if (exigirSenha && !isPublicPath(path) && !isAuthenticated(request)) {
      if (request.method === "GET") return redirect("/login");
      return json({ detail: "Sessao expirada ou nao autenticada" }, 401);
    }

    await ensureSchema(env);

    if (path === "/coletar" && request.method === "POST") return coletar(request, env);
    if (path === "/respostas" && request.method === "GET") return listarRespostas(env);
    if (path.match(/^\/respostas\/\d+$/) && request.method === "GET") {
      return visualizarFicha(Number(path.split("/").pop()), env);
    }
    if (path.match(/^\/atualizar\/\d+$/) && request.method === "POST") {
      return atualizar(Number(path.split("/").pop()), request, env);
    }
    if (path.match(/^\/excluir\/\d+$/) && request.method === "POST") {
      return excluir(Number(path.split("/").pop()), env);
    }
    if (path === "/exportar_excel" && request.method === "GET") return exportarCsv(env);
    if (path === "/mapa" && request.method === "GET") return redirect("/static/mapa.html");

    return env.ASSETS.fetch(request);
  }
};

function isPublicPath(path) {
  return path === "/login" ||
    path === "/autenticar" ||
    path === "/service-worker.js" ||
    path === "/static/service-worker.js" ||
    path === "/static/manifest.json" ||
    path === "/favicon.ico";
}

function isAuthenticated(request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map((part) => part.trim()).includes(`${COOKIE_NAME}=${COOKIE_VALUE}`);
}

function passwordRequired(env) {
  return ["1", "true", "sim", "yes"].includes(String(env.EXIGIR_SENHA || "false").toLowerCase());
}

function redirect(location, status = 303) {
  return new Response(null, { status, headers: { Location: location } });
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

async function ensureSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS respostas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_hora TEXT,
      latitude REAL,
      longitude REAL,
      dados_json TEXT
    )
  `).run();
}

function normalizarDados(dados = {}) {
  const identificacao = dados.identificacao || {};
  const pesquisa = dados.pesquisa || {};
  const localizacao = dados.localizacao || {};

  const normalizado = {
    identificacao: {
      nome: "",
      moradores_casa: "",
      povoado_bairro: "",
      endereco_rua: "",
      numero: ""
    },
    pesquisa: {
      ocupacao: "",
      religiao: "",
      governo_lula: "",
      governo_brandao: "",
      governo_dino_penha: "",
      voto_presidente: "",
      voto_governador: "",
      voto_deputado_estadual: "",
      voto_deputado_federal: "",
      influencia_apoio_prefeito: "",
      demandas_bairro_povoado: [],
      aprova_saude_municipio: "",
      aprova_educacao_municipio: "",
      aprova_infraestrutura_municipio: ""
    },
    localizacao: {
      latitude: localizacao.latitude ?? null,
      longitude: localizacao.longitude ?? null
    }
  };

  for (const campo of CAMPOS_IDENTIFICACAO) normalizado.identificacao[campo] = stringValue(identificacao[campo]);
  for (const campo of CAMPOS_PESQUISA) normalizado.pesquisa[campo] = stringValue(pesquisa[campo]);
  if (!normalizado.pesquisa.aprova_infraestrutura_municipio && pesquisa.aprova_estradas_municipio) {
    normalizado.pesquisa.aprova_infraestrutura_municipio = stringValue(pesquisa.aprova_estradas_municipio);
  }
  normalizado.pesquisa.demandas_bairro_povoado = Array.isArray(pesquisa.demandas_bairro_povoado)
    ? pesquisa.demandas_bairro_povoado.map(stringValue).filter(Boolean)
    : [];

  return normalizado;
}

function stringValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function roundCoord(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : null;
}

function normalizarCoordenadas(latitudeValue, longitudeValue) {
  const latitude = roundCoord(latitudeValue);
  const longitude = roundCoord(longitudeValue);
  if (!coordenadaValidaBrasil(latitude, longitude)) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

function coordenadaValidaBrasil(latitude, longitude) {
  if (latitude === null || longitude === null) return false;
  if (Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001) return false;
  return latitude >= LIMITES_BRASIL.minLat &&
    latitude <= LIMITES_BRASIL.maxLat &&
    longitude >= LIMITES_BRASIL.minLng &&
    longitude <= LIMITES_BRASIL.maxLng;
}

async function autenticar(request, env) {
  if (!passwordRequired(env)) {
    return redirect(`/static/index.html?v=${env.APP_VERSION || APP_VERSION_FALLBACK}`);
  }

  const form = await request.formData();
  const senha = String(form.get("senha") || "");
  const senhaSistema = env.SENHA_SISTEMA || "Lucasph12345";

  if (senha !== senhaSistema) return loginPage(true);

  return new Response(null, {
    status: 303,
    headers: {
      Location: `/static/index.html?v=${env.APP_VERSION || APP_VERSION_FALLBACK}`,
      "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`
    }
  });
}

function loginPage(erro) {
  return html(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Acesso Restrito</title>
  <style>
    body { font-family: Arial, sans-serif; background:#f3f4f6; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; padding:16px; }
    .login-card { background:white; padding:36px; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center; width:100%; max-width:360px; }
    h1 { color:#111827; font-size:24px; margin:0 0 16px; }
    p { color:#6b7280; }
    input { width:100%; padding:12px; margin-bottom:15px; border:1px solid #d1d5db; border-radius:6px; box-sizing:border-box; font-size:16px; }
    button { width:100%; background:#0f766e; color:white; border:none; padding:12px; border-radius:6px; font-size:16px; font-weight:bold; cursor:pointer; }
    .erro { color:#b91c1c; font-weight:bold; }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>Acesso Restrito</h1>
    <p>Digite a senha para acessar o sistema.</p>
    ${erro ? '<p class="erro">Senha incorreta!</p>' : ''}
    <form action="/autenticar" method="POST">
      <input type="password" name="senha" placeholder="Sua senha" required autofocus>
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`);
}

async function coletar(request, env) {
  const dados = normalizarDados(await request.json());
  const { latitude, longitude } = normalizarCoordenadas(dados.localizacao.latitude, dados.localizacao.longitude);
  dados.localizacao.latitude = latitude;
  dados.localizacao.longitude = longitude;

  await env.DB.prepare(`
    INSERT INTO respostas (data_hora, latitude, longitude, dados_json)
    VALUES (?, ?, ?, ?)
  `).bind(new Date().toISOString(), latitude, longitude, JSON.stringify(dados)).run();

  return json({ status: "ok" });
}

async function listarRespostas(env) {
  const result = await env.DB.prepare(`
    SELECT id, data_hora, latitude, longitude, dados_json
    FROM respostas
    ORDER BY id DESC
  `).all();

  return json(result.results.map((row) => {
    const coordenadas = normalizarCoordenadas(row.latitude, row.longitude);
    const dados = normalizarDados(JSON.parse(row.dados_json || "{}"));
    dados.localizacao.latitude = coordenadas.latitude;
    dados.localizacao.longitude = coordenadas.longitude;

    return {
      id: row.id,
      data_hora: row.data_hora,
      latitude: coordenadas.latitude,
      longitude: coordenadas.longitude,
      dados
    };
  }));
}

async function visualizarFicha(id, env) {
  const row = await env.DB.prepare("SELECT dados_json FROM respostas WHERE id = ?").bind(id).first();
  if (!row) return html("Registro não encontrado", 404);
  const dados = normalizarDados(JSON.parse(row.dados_json || "{}"));
  return html(renderFicha(id, dados));
}

async function atualizar(id, request, env) {
  const form = await request.formData();
  const demandas = form.getAll("demandas_bairro_povoado").map(stringValue).filter(Boolean);
  const demandaOutra = stringValue(form.get("demandas_outros")).trim();
  if (demandaOutra) demandas.push(demandaOutra);

  const dados = normalizarDados({
    identificacao: Object.fromEntries(CAMPOS_IDENTIFICACAO.map((campo) => [campo, form.get(campo)])),
    pesquisa: {
      ...Object.fromEntries(CAMPOS_PESQUISA.map((campo) => [campo, form.get(campo)])),
      demandas_bairro_povoado: demandas
    }
  });

  await env.DB.prepare("UPDATE respostas SET dados_json = ? WHERE id = ?")
    .bind(JSON.stringify(dados), id)
    .run();
  return redirect(`/respostas/${id}`);
}

async function excluir(id, env) {
  await env.DB.prepare("DELETE FROM respostas WHERE id = ?").bind(id).run();
  return redirect("/static/mapa.html");
}

async function exportarCsv(env) {
  const result = await env.DB.prepare(`
    SELECT data_hora, latitude, longitude, dados_json
    FROM respostas
    ORDER BY id DESC
  `).all();

  const headers = [
    "Data/Hora", "Latitude", "Longitude", "Nome", "Pessoas na Casa", "Povoado/Bairro",
    "Endereco/Rua", "Numero", "Ocupacao", "Religiao", "Governo Lula",
    "Governo Brandao", "Governo Dino Penha", "Voto Presidente", "Voto Governador",
    "Voto Deputado Estadual", "Voto Deputado Federal", "Influencia Apoio do Prefeito",
    "Demandas Bairro/Povoado",
    "Aprova Saude Municipio", "Aprova Educacao Municipio", "Aprova Infraestrutura Municipio"
  ];

  const linhas = [headers];
  for (const row of result.results) {
    const dados = normalizarDados(JSON.parse(row.dados_json || "{}"));
    const coordenadas = normalizarCoordenadas(row.latitude, row.longitude);
    const i = dados.identificacao;
    const p = dados.pesquisa;
    linhas.push([
      row.data_hora, coordenadas.latitude, coordenadas.longitude, i.nome, i.moradores_casa, i.povoado_bairro,
      i.endereco_rua, i.numero, p.ocupacao, p.religiao, p.governo_lula,
      p.governo_brandao, p.governo_dino_penha, p.voto_presidente, p.voto_governador,
      p.voto_deputado_estadual, p.voto_deputado_federal,
      p.influencia_apoio_prefeito,
      p.demandas_bairro_povoado.join(", "), p.aprova_saude_municipio,
      p.aprova_educacao_municipio, p.aprova_infraestrutura_municipio
    ]);
  }

  const delimiter = ";";
  const csv = [
    `sep=${delimiter}`,
    ...linhas.map((linha) => linha.map((cell) => csvCell(cell)).join(delimiter))
  ].join("\r\n");

  return new Response(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=pesquisa_opiniao_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.csv`
    }
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checked(demandas, demanda) {
  return demandas.includes(demanda) ? "checked" : "";
}

function selected(value, option) {
  return value === option ? "selected" : "";
}

function renderFicha(id, dados) {
  const i = dados.identificacao;
  const p = dados.pesquisa;
  const demandas = p.demandas_bairro_povoado;
  const demandasExtras = demandas.filter((demanda) => !DEMANDAS.includes(demanda)).join(", ");
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editar Pesquisa #${id}</title>
  <style>
    body { font-family: Arial, sans-serif; background:#f3f4f6; padding:20px; color:#1f2937; }
    .container { max-width:900px; margin:0 auto; background:white; padding:28px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.08); }
    .topo { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    h1 { font-size:24px; margin:0; color:#111827; }
    h2 { font-size:17px; margin:26px 0 10px; color:#0f766e; border-bottom:1px solid #d1d5db; padding-bottom:6px; }
    label { display:block; margin-top:12px; font-weight:700; }
    input, select { width:100%; padding:10px; margin-top:5px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box; font-size:15px; }
    .linha { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .opcoes { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px 12px; margin-top:8px; }
    .opcoes label { display:flex; align-items:center; gap:8px; margin:0; padding:8px; border:1px solid #d1d5db; border-radius:6px; font-weight:500; }
    .opcoes input { width:auto; margin:0; }
    .btn-salvar { background:#0f766e; color:white; padding:14px 24px; border:none; border-radius:6px; cursor:pointer; font-size:16px; font-weight:700; margin-top:24px; }
    .btn-excluir { background:#b91c1c; color:white; padding:14px 18px; border:none; border-radius:6px; cursor:pointer; font-weight:700; margin-top:14px; }
    a { color:#2563eb; text-decoration:none; font-weight:700; }
    @media (max-width:640px) { body { padding:12px; } .container { padding:16px; } .topo, .linha { display:block; } button { width:100%; } }
  </style>
</head>
<body>
<div class="container">
  <div class="topo">
    <h1>Pesquisa #${id}</h1>
    <a href="/static/mapa.html">Voltar ao mapa</a>
  </div>
  <form action="/atualizar/${id}" method="post">
    <h2>Identificação</h2>
    <label>Nome</label><input name="nome" value="${escapeHtml(i.nome)}">
    <div class="linha">
      <div><label>Quantas pessoas moram na casa?</label><input name="moradores_casa" value="${escapeHtml(i.moradores_casa)}"></div>
      <div><label>Povoado ou bairro</label><input name="povoado_bairro" value="${escapeHtml(i.povoado_bairro)}"></div>
    </div>
    <div class="linha">
      <div><label>Endereço / rua</label><input name="endereco_rua" value="${escapeHtml(i.endereco_rua)}"></div>
      <div><label>Número</label><input name="numero" value="${escapeHtml(i.numero)}"></div>
    </div>
    <h2>Perfil</h2>
    <label>1. Ocupação</label><input name="ocupacao" value="${escapeHtml(p.ocupacao)}">
    <label>2. Religião</label><input name="religiao" value="${escapeHtml(p.religiao)}">
    <h2>Avaliação de Governo</h2>
    ${approvalSelect("3. Governo Lula", "governo_lula", p.governo_lula)}
    ${approvalSelect("4. Governo Brandão", "governo_brandao", p.governo_brandao)}
    ${approvalSelect("5. Governo de Dino Penha", "governo_dino_penha", p.governo_dino_penha)}
    <h2>Intenção de Voto</h2>
    <label>6. Presidente</label><input name="voto_presidente" value="${escapeHtml(p.voto_presidente)}">
    <label>7. Governador</label><input name="voto_governador" value="${escapeHtml(p.voto_governador)}">
    <label>8. Deputado estadual</label><input name="voto_deputado_estadual" value="${escapeHtml(p.voto_deputado_estadual)}">
    <label>9. Deputado federal</label><input name="voto_deputado_federal" value="${escapeHtml(p.voto_deputado_federal)}">
    <label>10. Influência do apoio do prefeito</label><input name="influencia_apoio_prefeito" value="${escapeHtml(p.influencia_apoio_prefeito)}">
    <h2>Prioridades e Serviços</h2>
    <label>11. O que o bairro/povoado mais precisa?</label>
    <div class="opcoes">
      ${DEMANDAS.map((demanda) => `<label><input type="checkbox" name="demandas_bairro_povoado" value="${escapeHtml(demanda)}" ${checked(demandas, demanda)}> ${escapeHtml(demanda)}</label>`).join("")}
    </div>
    <label>Outros</label><input name="demandas_outros" value="${escapeHtml(demandasExtras)}">
    ${approvalSelect("12. Aprovação do setor saúde do município", "aprova_saude_municipio", p.aprova_saude_municipio)}
    ${approvalSelect("13. Aprovação do setor educação do município", "aprova_educacao_municipio", p.aprova_educacao_municipio)}
    ${approvalSelect("14. Aprovação do setor de infraestrutura do município", "aprova_infraestrutura_municipio", p.aprova_infraestrutura_municipio)}
    <button type="submit" class="btn-salvar">Salvar alterações</button>
  </form>
  <form action="/excluir/${id}" method="post" onsubmit="return confirm('Tem certeza que deseja excluir esta pesquisa?');">
    <button type="submit" class="btn-excluir">Excluir pesquisa</button>
  </form>
</div>
</body>
</html>`;
}

function approvalSelect(label, name, value) {
  return `<label>${escapeHtml(label)}</label>
  <select name="${escapeHtml(name)}">
    <option value=""></option>
    <option value="Aprova" ${selected(value, "Aprova")}>Aprova</option>
    <option value="Não Aprova" ${selected(value, "Não Aprova")}>Não Aprova</option>
    <option value="Não Sabe" ${selected(value, "Não Sabe")}>Não Sabe</option>
  </select>`;
}
