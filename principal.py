from fastapi import FastAPI, HTTPException, Request, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse, StreamingResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware # Necessário para o bloqueio
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import sqlite3
import json
import os
from datetime import datetime
import openpyxl
from openpyxl.styles import Font
from io import BytesIO

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.getenv("DB_PATH", os.path.join(BASE_DIR, "dados.db"))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
APP_VERSION = "20260722-pesquisa-opiniao"
LIMITES_BRASIL = {
    "min_lat": -34,
    "max_lat": 6,
    "min_lng": -74,
    "max_lng": -34,
}

# ==========================================
# 🔐 CONFIGURAÇÃO DE SEGURANÇA
# ==========================================
SENHA_SISTEMA = os.getenv("SENHA_SISTEMA", "Lucasph12345")
EXIGIR_SENHA = os.getenv("EXIGIR_SENHA", "false").lower() in {"1", "true", "sim", "yes"}
# ==========================================

app = FastAPI()

# --- MIDDLEWARE DE SEGURANÇA (O PORTEIRO) ---
class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not EXIGIR_SENHA:
            return await call_next(request)

        path = request.url.path
        
        # Arquivos liberados sem senha
        whitelist = [
            "/login", 
            "/autenticar", 
            "/service-worker.js", 
            "/static/manifest.json",
            "/favicon.ico"
        ]

        # Se for arquivo da whitelist ou se for CSS/JS/Imagens do login (se houver), deixa passar
        if path in whitelist:
            return await call_next(request)

        # Verifica o Cookie "crachá"
        cookie_token = request.cookies.get("sessao_usuario")
        
        if cookie_token == "acesso_liberado_ok":
            return await call_next(request)

        if request.method != "GET" or path in {"/coletar", "/respostas"}:
            return JSONResponse({"detail": "Sessao expirada ou nao autenticada"}, status_code=401)
        
        # Se não tiver o cookie, manda para o Login
        return RedirectResponse(url="/login", status_code=303)

app.add_middleware(SecurityMiddleware)

# --- CONFIGURAÇÃO DE TEMPLATES ---
if not os.path.exists(TEMPLATES_DIR):
    os.makedirs(TEMPLATES_DIR)

templates = Jinja2Templates(directory=TEMPLATES_DIR)

# --- BANCO DE DADOS ---
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def criar_tabela():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS respostas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_hora TEXT,
            latitude REAL,
            longitude REAL,
            dados_json TEXT
        )
    """)
    conn.commit()
    conn.close()

criar_tabela()

# --- ARQUIVOS ESTÁTICOS ---
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def home():
    return RedirectResponse(url=f"/static/index.html?v={APP_VERSION}")

# --- MODELOS ---
class Localizacao(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class Dados(BaseModel):
    identificacao: Dict[str, Any]
    pesquisa: Dict[str, Any]
    localizacao: Localizacao

def normalizar_dados_pesquisa(dados: Dict[str, Any]) -> Dict[str, Any]:
    dados.setdefault("identificacao", {})
    dados.setdefault("pesquisa", {})
    dados.setdefault("localizacao", {"latitude": None, "longitude": None})

    identificacao_padrao = {
        "nome": "",
        "telefone": "",
        "povoado_bairro": "",
        "endereco_rua": "",
        "numero": "",
    }
    pesquisa_padrao = {
        "ocupacao": "",
        "religiao": "",
        "governo_lula": "",
        "governo_brandao": "",
        "governo_dino_penha": "",
        "voto_governador": "",
        "voto_deputado_estadual": "",
        "voto_deputado_federal": "",
        "demandas_bairro_povoado": [],
        "aprova_saude_municipio": "",
        "aprova_educacao_municipio": "",
        "aprova_estradas_municipio": "",
    }

    for chave, valor in identificacao_padrao.items():
        dados["identificacao"].setdefault(chave, valor)
    for chave, valor in pesquisa_padrao.items():
        dados["pesquisa"].setdefault(chave, valor)
    if not isinstance(dados["pesquisa"].get("demandas_bairro_povoado"), list):
        dados["pesquisa"]["demandas_bairro_povoado"] = []

    return dados

def normalizar_coordenadas(latitude_valor, longitude_valor):
    try:
        latitude = round(float(latitude_valor), 6) if latitude_valor not in (None, "") else None
        longitude = round(float(longitude_valor), 6) if longitude_valor not in (None, "") else None
    except (TypeError, ValueError):
        return None, None
    if not coordenada_valida_brasil(latitude, longitude):
        return None, None
    return latitude, longitude

def coordenada_valida_brasil(latitude, longitude):
    if latitude is None or longitude is None:
        return False
    if abs(latitude) < 0.000001 and abs(longitude) < 0.000001:
        return False
    return (
        LIMITES_BRASIL["min_lat"] <= latitude <= LIMITES_BRASIL["max_lat"] and
        LIMITES_BRASIL["min_lng"] <= longitude <= LIMITES_BRASIL["max_lng"]
    )

# ==========================================
# 🔐 ROTAS DE LOGIN
# ==========================================
@app.get("/login", response_class=HTMLResponse)
async def pagina_login(request: Request):
    if not EXIGIR_SENHA:
        return RedirectResponse(url=f"/static/index.html?v={APP_VERSION}", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "erro": False})

@app.post("/autenticar")
async def autenticar(request: Request, senha: str = Form(...)):
    if not EXIGIR_SENHA:
        return RedirectResponse(url=f"/static/index.html?v={APP_VERSION}", status_code=303)

    if senha == SENHA_SISTEMA:
        # Senha correta: Cria cookie de 30 dias
        response = RedirectResponse(url="/static/index.html", status_code=303)
        segundos_30_dias = 60 * 60 * 24 * 30
        response.set_cookie(
            key="sessao_usuario", 
            value="acesso_liberado_ok", 
            max_age=segundos_30_dias, 
            httponly=True,
            samesite="lax"
        )
        return response
    else:
        return templates.TemplateResponse("login.html", {"request": request, "erro": True})

# ==========================================
# ⚙️ ROTAS DO SISTEMA (Mantidas do seu código)
# ==========================================

@app.post("/excluir/{id_resposta}")
def excluir(id_resposta: int):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM respostas WHERE id = ?", (id_resposta,))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Erro ao excluir: {e}")
    conn.close()
    return RedirectResponse(url="/static/mapa.html", status_code=303)

@app.post("/atualizar/{id_resposta}")
async def atualizar(id_resposta: int, request: Request):
    form_data = await request.form()
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT dados_json FROM respostas WHERE id = ?", (id_resposta,))
    resultado = cursor.fetchone()
    
    if not resultado:
        conn.close()
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    
    d = normalizar_dados_pesquisa(json.loads(resultado["dados_json"]))

    try:
        d["identificacao"] = {
            "nome": form_data.get("nome", ""),
            "telefone": form_data.get("telefone", ""),
            "povoado_bairro": form_data.get("povoado_bairro", ""),
            "endereco_rua": form_data.get("endereco_rua", ""),
            "numero": form_data.get("numero", ""),
        }
        d["pesquisa"] = {
            "ocupacao": form_data.get("ocupacao", ""),
            "religiao": form_data.get("religiao", ""),
            "governo_lula": form_data.get("governo_lula", ""),
            "governo_brandao": form_data.get("governo_brandao", ""),
            "governo_dino_penha": form_data.get("governo_dino_penha", ""),
            "voto_governador": form_data.get("voto_governador", ""),
            "voto_deputado_estadual": form_data.get("voto_deputado_estadual", ""),
            "voto_deputado_federal": form_data.get("voto_deputado_federal", ""),
            "demandas_bairro_povoado": form_data.getlist("demandas_bairro_povoado"),
            "aprova_saude_municipio": form_data.get("aprova_saude_municipio", ""),
            "aprova_educacao_municipio": form_data.get("aprova_educacao_municipio", ""),
            "aprova_estradas_municipio": form_data.get("aprova_estradas_municipio", ""),
        }
        
        novo_json = json.dumps(d, ensure_ascii=False)
        cursor.execute("UPDATE respostas SET dados_json = ? WHERE id = ?", (novo_json, id_resposta))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Erro ao salvar: {e}")
    
    conn.close()
    return RedirectResponse(url=f"/respostas/{id_resposta}", status_code=303)

@app.get("/exportar_excel")
def exportar_excel():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT data_hora, latitude, longitude, dados_json FROM respostas ORDER BY id DESC")
    registros = cursor.fetchall()
    conn.close()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Pesquisa Opiniao"

    headers = [
        "Data/Hora", "Latitude", "Longitude", "Nome", "Telefone",
        "Povoado/Bairro", "Endereco/Rua", "Numero", "Ocupacao", "Religiao",
        "Governo Lula", "Governo Brandao", "Governo Dino Penha",
        "Voto Governador", "Voto Deputado Estadual", "Voto Deputado Federal",
        "Demandas Bairro/Povoado", "Aprova Saude Municipio",
        "Aprova Educacao Municipio", "Aprova Estradas Municipio"
    ]
    
    ws.append(headers)
    for cell in ws[1]: cell.font = Font(bold=True)

    for row in registros:
        try:
            dados = normalizar_dados_pesquisa(json.loads(row["dados_json"]))
            ident = dados.get("identificacao", {})
            pesquisa = dados.get("pesquisa", {})
            demandas = pesquisa.get("demandas_bairro_povoado", [])
            txt_demandas = "; ".join(demandas) if isinstance(demandas, list) else ""

            latitude, longitude = normalizar_coordenadas(row["latitude"], row["longitude"])

            ws.append([
                row["data_hora"], latitude, longitude,
                ident.get("nome", ""), ident.get("telefone", ""),
                ident.get("povoado_bairro", ""), ident.get("endereco_rua", ""),
                ident.get("numero", ""), pesquisa.get("ocupacao", ""),
                pesquisa.get("religiao", ""), pesquisa.get("governo_lula", ""),
                pesquisa.get("governo_brandao", ""), pesquisa.get("governo_dino_penha", ""),
                pesquisa.get("voto_governador", ""), pesquisa.get("voto_deputado_estadual", ""),
                pesquisa.get("voto_deputado_federal", ""), txt_demandas,
                pesquisa.get("aprova_saude_municipio", ""),
                pesquisa.get("aprova_educacao_municipio", ""),
                pesquisa.get("aprova_estradas_municipio", "")
            ])
        except: continue

    for column_cells in ws.columns:
        length = max(len(str(cell.value or "")) for cell in column_cells)
        ws.column_dimensions[column_cells[0].column_letter].width = length + 2

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    filename = f"pesquisa_opiniao_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/respostas/{id_resposta}", response_class=HTMLResponse)
def visualizar_ficha(request: Request, id_resposta: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT dados_json FROM respostas WHERE id = ?", (id_resposta,))
    resultado = cursor.fetchone()
    conn.close()

    if resultado:
        dados_json = normalizar_dados_pesquisa(json.loads(resultado["dados_json"]))
              
        return templates.TemplateResponse("ficha.html", {
            "request": request, 
            "dados": dados_json, 
            "id": id_resposta
        })
    raise HTTPException(status_code=404, detail="Registro não encontrado")

@app.post("/coletar")
def coletar(dados: Dados):
    conn = get_db()
    cursor = conn.cursor()
    
    payload = normalizar_dados_pesquisa(dados.model_dump())

    latitude, longitude = normalizar_coordenadas(dados.localizacao.latitude, dados.localizacao.longitude)
    payload["localizacao"]["latitude"] = latitude
    payload["localizacao"]["longitude"] = longitude

    cursor.execute("""
        INSERT INTO respostas (data_hora, latitude, longitude, dados_json)
        VALUES (?, ?, ?, ?)
    """, (
        datetime.now().isoformat(),
        latitude,
        longitude,
        json.dumps(payload, ensure_ascii=False)
    ))
    conn.commit()
    conn.close()
    return {"status": "ok"}

@app.get("/respostas")
def listar_respostas():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, data_hora, latitude, longitude, dados_json FROM respostas ORDER BY id DESC")
    registros = []
    for row in cursor.fetchall():
        latitude, longitude = normalizar_coordenadas(row["latitude"], row["longitude"])
        dados = normalizar_dados_pesquisa(json.loads(row["dados_json"]))
        dados["localizacao"]["latitude"] = latitude
        dados["localizacao"]["longitude"] = longitude
        registros.append({
            "id": row["id"],
            "data_hora": row["data_hora"],
            "latitude": latitude,
            "longitude": longitude,
            "dados": dados
        })
    conn.close()
    return registros

@app.get("/mapa")
def mapa():
    return FileResponse(os.path.join(STATIC_DIR, "mapa.html"))

@app.get("/service-worker.js")
async def service_worker():
    response = FileResponse(os.path.join(BASE_DIR, "service-worker.js"))
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response
