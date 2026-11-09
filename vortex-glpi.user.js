// ==UserScript==
// @name         Vortex — lançar visita no GLPI
// @namespace    otowm.vortex
// @version      1.8.2
// @homepageURL  https://github.com/otowm/om30-vortex
// @updateURL    https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-glpi.user.js
// @downloadURL  https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-glpi.user.js
// @description  Preenche o novo chamado com a visita. Confira e clique em Adicionar no GLPI.
// @match        https://vortexom30.replit.app/*
// @match        https://suporte.om30.cloud/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @sandbox      JavaScript
// ==/UserScript==

(function () {
  'use strict';

  const ENTIDADE = 567;
  const NOME_ENTIDADE = 'OM30 > CLIENTES > PREFEITURA DE GUARUJÁ';
  const TIPO = 2;
  const STATUS = 5;
  const CATEGORIA_PADRAO = 89;
  const NOME_CATEGORIA = 'TI > Sistemas > Saúde Simples > Prontuário Eletrônico';
  const GRUPO_SISTEMAS = 9;
  const GRUPO_SERVICE_DESK = 2;
  const URL_GLPI = 'https://suporte.om30.cloud/front/ticket.form.php';
  const VALIDADE = 30 * 60 * 1000;

  const texto = (v) => v == null ? '' : String(v).trim();
  const normalizar = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const escapar = (v) => texto(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const lista = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && texto(x)).map(texto) : [];

  // ── 1. Visita → lançamento (sem depender da página) ─────────────────────
  function montarLancamento(visita) {
    const tipo = texto(visita.tipoVisita).replace(/Operação assisitda/gi, 'Operação assistida');
    const motivo = texto(visita.motivoVisita).replace(/\s+/g, ' ');
    const unidade = texto(visita.unidade);
    // O campo Título do GLPI aceita 255 caracteres; preserva tipo e unidade.
    const base = [tipo, unidade].filter(Boolean).join(' - ');
    const espacoMotivo = Math.max(0, 255 - base.length - (base ? 3 : 0));
    const motivoTitulo = motivo.length > espacoMotivo
      ? (espacoMotivo > 1 ? motivo.slice(0, espacoMotivo - 1).trimEnd() + '…' : '') : motivo;
    const titulo = [tipo, motivoTitulo, unidade].filter(Boolean).join(' - ').slice(0, 255);
    const modulos = [...new Set(Object.values(visita.modulos || {}).flatMap(lista))];
    const linhas = [];
    const linha = (rotulo, valor) => {
      if (texto(valor)) linhas.push(`<p><strong>${escapar(rotulo)}:</strong> ${escapar(valor).replace(/\r\n?|\n/g, '<br>')}</p>`);
    };
    linha('Observações', visita.observacoes);
    linha('Setores', lista(visita.setores).join(', '));
    const sistemas = [...new Set([...lista(visita.sistemas), ...Object.keys(visita.modulos || {})])];
    linha('Sistemas / módulos', sistemas.map((s) => {
      const nome = visita.sistemasLabels?.[s] || s;
      const nomes = lista(visita.modulos?.[s]);
      return nomes.length ? `${nome}: ${nomes.join(', ')}` : nome;
    }).join('; '));
    linha('Responsável', [visita.responsavelNome, visita.responsavelCargo].map(texto).filter(Boolean).join(' — '));
    linha('Técnico', visita.tecnico);
    linha('Status do atendimento', visita.statusAtendimento);
    if (normalizar(visita.statusAtendimento).replace(/[ _-]/g, '') === 'naoatendido') linha('Justificativa', visita.justificativaNaoAtendido);
    for (const [chave, valor] of Object.entries(visita.customFields || {})) {
      const simples = (v) => (typeof v === 'string' || typeof v === 'number') && !/^data:/i.test(texto(v));
      const conteudo = Array.isArray(valor) && valor.every((v) => typeof v === 'string')
        ? valor.filter(simples).map(texto).filter(Boolean).join(', ') : simples(valor) ? texto(valor) : '';
      const meta = visita.customFieldsMeta?.find((m) => chave === m.id || chave === 'custom_' + m.id);
      const rotulo = meta?.label || chave;
      // Alguns modelos repetem a data da visita como um campo personalizado.
      if (normalizar(rotulo) === 'data' && [texto(visita.data), dataIso(visita.data)].includes(conteudo)) continue;
      if (normalizar(rotulo) === 'motivo' && texto(conteudo).replace(/\s+/g, ' ') === motivo) continue;
      linha(rotulo, conteudo);
    }
    const id = texto(visita.id);
    if (id) {
      const dia = dataIso(visita.data);
      const parametros = new URLSearchParams(dia ? { dataDe: dia, dataAte: dia, vx_ficha: id } : { vx_ficha: id });
      if (unidade) parametros.set('busca', unidade);
      linhas.push(`<p><strong>Ficha Vortex:</strong> <a href="${escapar('https://vortexom30.replit.app/historico?' + parametros)}">${escapar(id)}</a></p>`);
    }
    return {
      titulo,
      tituloAbreviado: titulo !== [tipo, motivo, unidade].filter(Boolean).join(' - '),
      descricaoHtml: linhas.join('\n'),
      unidade, modulos, visitId: texto(visita.id),
      data: texto(visita.data), horaInicio: texto(visita.horaInicio), horaFim: texto(visita.horaFim),
      dataAbertura: dataAbertura(visita.data, visita.horaInicio),
      duracaoSegundos: duracao(visita),
    };
  }

  function dataIso(data) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto(data));
    if (!d) return '';
    const iso = `${d[3]}-${d[2]}-${d[1]}`;
    const valor = new Date(iso + 'T00:00:00Z');
    return !isNaN(valor) && valor.toISOString().slice(0, 10) === iso ? iso : '';
  }

  // "06/11/2026" + "15:43" → "2026-11-06 15:43:00" (formato do campo date do GLPI).
  function dataAbertura(data, hora) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto(data));
    const h = /^(\d{1,2}):(\d{2})$/.exec(texto(hora));
    return d && h ? `${d[3]}-${d[2]}-${d[1]} ${h[1].padStart(2, '0')}:${h[2]}:00` : '';
  }

  // A duração do Vortex já reflete correções de horário; sem ela, usa fim − início.
  function duracao(visita) {
    const segundos = Number(visita.duracaoSegundos);
    if (Number.isFinite(segundos) && segundos > 0) return Math.round(segundos);
    const minutos = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(texto(h)); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
    const diferenca = minutos(visita.horaFim) - minutos(visita.horaInicio);
    if (!Number.isFinite(diferenca)) return 0;
    return ((diferenca + 1440) % 1440) * 60;
  }

  // Opção de "Duração total" (passos de 5 min no formulário novo) mais próxima.
  function opcaoDuracao(opcoes, segundos) {
    const validas = opcoes.map((o) => ({ valor: Number(o.value), texto: texto(o.textContent) })).filter((o) => o.valor > 0);
    if (!(segundos > 0) || !validas.length) return null;
    return validas.reduce((melhor, o) => Math.abs(o.valor - segundos) < Math.abs(melhor.valor - segundos) ? o : melhor);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { montarLancamento, opcaoDuracao };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const pagina = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const registrar = (etapa, erro) => console.warn('[vortex-glpi]', etapa, erro);

  const SELECTS_RASCUNHO = ['entities_id', 'type', 'status', 'itilcategories_id', 'locations_id', 'urgency', 'impact', 'requesttypes_id', 'actiontime'];
  const TIPOS_ATOR = ['requester', 'observer', 'assign'];
  const CHAVE_ATUAL = 'vxGlpiRascunhoAtual';
  let atualizarRascunhos = () => {};
  let cancelarAutossalvar = () => {};

  function rascunhos() {
    return GM_getValue('vxGlpiRascunhos', {});
  }

  function guardarRascunhos(dados) {
    const recentes = Object.values(dados)
      .filter((r) => Date.now() - Number(r.atualizadoEm) <= 30 * 24 * 60 * 60 * 1000)
      .sort((a, b) => b.atualizadoEm - a.atualizadoEm).slice(0, 50);
    GM_setValue('vxGlpiRascunhos', Object.fromEntries(recentes.map((r) => [r.id, r])));
    atualizarRascunhos();
  }

  function novoRascunho(dados) {
    const em = Date.now();
    return { id: pagina.crypto.randomUUID(), criadoEm: em, atualizadoEm: em, ...dados };
  }

  function excluirRascunho(id) {
    const dados = rascunhos();
    delete dados[id];
    if (sessionStorage.getItem(CHAVE_ATUAL) === id) {
      sessionStorage.removeItem(CHAVE_ATUAL);
      cancelarAutossalvar();
      document.getElementById('vx-glpi-rascunho-salvo')?.remove();
    }
    for (const chave of ['vxGlpiRetomar', 'vxGlpiPendente']) {
      if (lerEstado(chave)?.rascunhoId === id) apagarEstado(chave);
    }
    guardarRascunhos(dados);
  }

  // Ordens de preencher (vxGlpiPendente) e restaurar (vxGlpiRetomar). O
  // GM_setValue do Tampermonkey grava em segundo plano: navegar logo depois
  // às vezes abria a página antes de a ordem chegar, e o formulário vinha
  // vazio. A cópia na aba (sessionStorage) é síncrona e sobrevive às
  // recargas do formulário; o GM continua valendo entre guias.
  function lerEstado(chave) {
    try {
      const salvo = sessionStorage.getItem(chave);
      if (salvo) return JSON.parse(salvo);
    } catch { /* usa o GM */ }
    return GM_getValue(chave, null);
  }

  function gravarEstado(chave, valor) {
    try { sessionStorage.setItem(chave, JSON.stringify(valor)); } catch { /* fica só no GM */ }
    GM_setValue(chave, valor);
  }

  function apagarEstado(chave) {
    try { sessionStorage.removeItem(chave); } catch { /* nada a fazer */ }
    GM_deleteValue(chave);
  }

  // Compatibilidade com links de rascunho gerados antes da abertura imediata.
  function receberDaUrl() {
    const achado = /[#&]vx=([^&]*)/.exec(location.hash);
    if (!achado) return;
    try {
      const { rascunho } = JSON.parse(decodeURIComponent(achado[1]));
      receberRascunho(rascunho);
    } catch (erro) { registrar('rascunho na URL', erro); }
    history.replaceState(history.state, '', location.pathname + location.search);
  }

  function receberRascunho(rascunho) {
    const dados = rascunhos();
    const guardado = dados[rascunho.id];
    const maisNovo = guardado && Number(guardado.atualizadoEm) >= Number(rascunho.atualizadoEm) ? guardado : rascunho;
    if (maisNovo === rascunho) guardarRascunhos({ ...dados, [rascunho.id]: rascunho });
    sessionStorage.setItem(CHAVE_ATUAL, maisNovo.id);
    prepararRetomada(maisNovo);
  }

  // Cada clique tem sua própria entrega GM; duas abas não consomem a mesma ficha.
  function aguardarLancamento() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const entrega = hash.get('vx_aguardar') || sessionStorage.getItem('vxGlpiAguardando');
    if (!entrega) return false;
    sessionStorage.setItem('vxGlpiAguardando', entrega);
    if (hash.has('vx_aguardar')) {
      hash.delete('vx_aguardar');
      history.replaceState(history.state, '', location.pathname + location.search + (hash.size ? '#' + hash : ''));
    }
    mostrarCarregamento('Buscando ficha no Vortex…');
    const inicio = Date.now();
    const chave = 'vxGlpiEntrega:' + entrega;
    const liberar = () => {
      clearInterval(intervalo);
      ocultarCarregamento();
    };
    const terminar = () => {
      liberar();
      window.removeEventListener('pagehide', liberar);
      sessionStorage.removeItem('vxGlpiAguardando');
    };
    const consultar = () => {
      const resultado = GM_getValue(chave, null);
      const idade = Date.now() - Number(resultado?.em);
      if (resultado && idade >= 0 && idade < VALIDADE) {
        terminar();
        GM_deleteValue(chave);
        if (resultado.erro) { ocultarCarregamento(); faixa(resultado.erro); return; }
        if (resultado.chamado) { mostrarCarregamento('Abrindo chamado existente…'); location.href = URL_GLPI + '?id=' + resultado.chamado; return; }
        receberRascunho(resultado.rascunho);
        mostrarCarregamento('Ficha recebida. Preparando o chamado…');
        iniciarGlpi();
      } else if (Date.now() - inicio >= 60000) {
        terminar();
        ocultarCarregamento();
        faixa('O Vortex não respondeu a tempo. Volte à ficha e clique em Lançar no GLPI novamente.');
      }
    };
    const intervalo = setInterval(consultar, 250);
    window.addEventListener('pagehide', liberar, { once: true });
    consultar();
    return true;
  }

  function rascunhoDaVisita(id) {
    return Object.values(rascunhos()).find((r) => r.visitId === texto(id));
  }

  function prepararRetomada(rascunho) {
    if (rascunho.campos) {
      apagarEstado('vxGlpiPendente');
      gravarEstado('vxGlpiRetomar', { rascunhoId: rascunho.id, em: Date.now() });
      return URL_GLPI + '?entities_id=' + encodeURIComponent(rascunho.campos.entities_id.value);
    }
    apagarEstado('vxGlpiRetomar');
    gravarEstado('vxGlpiPendente', { lancamento: rascunho.lancamento, criadoEm: Date.now(), rascunhoId: rascunho.id });
    return `${URL_GLPI}?entities_id=${ENTIDADE}&type=${TIPO}&status=${STATUS}&itilcategories_id=${CATEGORIA_PADRAO}`;
  }

  // "Rascunhos" no menu Assistência, logo abaixo de "Criar chamado", abrindo
  // uma página própria no lugar do conteúdo (menu e barra do GLPI ficam).
  // A página é /front/central.php?vx_rascunhos=1: o GLPI desenha a moldura e
  // o script troca o <main>. A home é ~5x mais leve que a lista de chamados
  // (128 KB × 624 KB na captura, e Chamados ainda faz a busca depois).
  const URL_RASCUNHOS = '/front/central.php?vx_rascunhos=1';
  const naPaginaRascunhos = () => location.pathname === '/front/central.php' && new URL(location.href).searchParams.has('vx_rascunhos');

  function menuRascunhos() {
    const criar = document.querySelector('a.dropdown-item[href="/front/ticket.form.php"]');
    if (!criar) return;
    let item = document.getElementById('vx-glpi-menu-rascunhos');
    if (!item) {
      item = document.createElement('a');
      item.id = 'vx-glpi-menu-rascunhos';
      item.className = 'dropdown-item';
      item.href = URL_RASCUNHOS;
      item.title = 'Rascunhos';
      item.innerHTML = '<i class="fa-fw ti ti-pencil"></i><span class="text-wrap"> Rascunhos </span><span class="badge bg-primary text-white ms-auto"></span>';
      criar.after(item);
    }
    const total = Object.keys(rascunhos()).length;
    const selo = item.querySelector('.badge');
    selo.textContent = String(total);
    selo.hidden = !total;
    if (naPaginaRascunhos() && !item.classList.contains('active')) {
      // Na home o menu Assistência vem fechado e nada dele está ativo: abre
      // como o GLPI faz nas páginas de Assistência e marca Rascunhos.
      document.querySelectorAll('.sidebar .nav-link.active, .dropdown-menu a.dropdown-item.active').forEach((a) => a.classList.remove('active'));
      item.classList.add('active');
      const submenu = item.closest('.dropdown-menu');
      const grupo = item.closest('li.nav-item');
      const abrir = grupo?.querySelector(':scope > .dropdown-toggle');
      submenu?.classList.add('show');
      grupo?.classList.add('active');
      abrir?.classList.add('active', 'show');
      abrir?.setAttribute('aria-expanded', 'true');
    }
  }

  function paginaRascunhos() {
    const main = document.querySelector('main#page') || document.querySelector('main');
    if (!main) return;
    document.title = 'Rascunhos - GLPI';
    const cartao = document.createElement('div');
    cartao.id = 'vx-glpi-pagina-rascunhos';
    cartao.className = 'card';
    cartao.style.cssText = 'display:block;width:100%';
    main.replaceChildren(cartao);
    const desenhar = () => {
      const lista = Object.values(rascunhos()).sort((a, b) => b.atualizadoEm - a.atualizadoEm);
      cartao.replaceChildren();
      const cabecalho = document.createElement('div');
      cabecalho.className = 'card-header';
      cabecalho.innerHTML = '<h3 class="card-title mb-0"></h3>';
      cabecalho.firstChild.textContent = `Rascunhos (${lista.length})`;
      cartao.append(cabecalho);
      const sincronizacao = document.createElement('div');
      sincronizacao.className = 'card-body text-muted';
      sincronizacao.style.fontSize = '.875em';
      const em = GM_getValue('vxGlpiSincronizadoEm', 0);
      const total = Object.values(GM_getValue('vxGlpiLancados', {})).filter((n) => /^\d+$/.test(String(n))).length;
      const estado = document.createElement('span');
      estado.textContent = em ? `Lançamentos sincronizados às ${horaLocal(em)} · ${total} fichas vinculadas` : 'Lançamentos ainda não sincronizados';
      const atualizar = document.createElement('button');
      atualizar.type = 'button'; atualizar.className = 'btn btn-sm btn-outline-primary ms-2'; atualizar.textContent = 'Atualizar';
      atualizar.disabled = !!sincronizacaoEmCurso;
      atualizar.onclick = () => sincronizarGlpi(true);
      sincronizacao.append(estado, atualizar);
      cartao.append(sincronizacao);
      if (!lista.length) {
        const vazio = document.createElement('div');
        vazio.className = 'card-body text-muted';
        vazio.textContent = 'Nenhum rascunho. Os chamados novos são guardados aqui enquanto você escreve, e somem ao clicar em Adicionar.';
        cartao.append(vazio);
        return;
      }
      const itens = document.createElement('div');
      itens.className = 'list-group list-group-flush';
      cartao.append(itens);
      for (const r of lista) {
        // Layout em bloco com estilos próprios: dentro do main.legacy do GLPI,
        // itens flex encolhiam até uma letra por linha.
        const item = document.createElement('div');
        item.className = 'list-group-item';
        item.style.cssText = 'display:block;width:100%';
        item.dataset.rascunhoId = r.id;
        const info = document.createElement('div');
        info.style.cssText = 'display:block;width:100%;overflow-wrap:break-word';
        const titulo = document.createElement('div');
        titulo.className = 'fw-bold';
        titulo.textContent = r.campos?.name || r.lancamento?.titulo || '(sem título)';
        if (r.origem === 'vortex') {
          const selo = document.createElement('span');
          selo.className = 'badge bg-primary text-white ms-2';
          selo.textContent = 'Vortex';
          titulo.append(selo);
        }
        const detalhe = document.createElement('div');
        // Sem a classe "small": o GLPI tem "#page .small { width: 1% }".
        detalhe.className = 'text-muted';
        detalhe.style.fontSize = '.875em';
        const data = new Date(r.atualizadoEm);
        const dia = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        detalhe.textContent = `${r.campos?.locations_id?.text || r.lancamento?.unidade || ''} · atualizado ${dia} ${hora}`;
        info.append(titulo, detalhe);
        const continuar = document.createElement('button');
        continuar.type = 'button'; continuar.className = 'btn btn-primary btn-sm'; continuar.textContent = 'Continuar';
        continuar.onclick = () => {
          const atual = rascunhos()[r.id];
          if (!atual) return;
          sessionStorage.setItem(CHAVE_ATUAL, atual.id);
          location.assign(prepararRetomada(atual));
        };
        const excluir = document.createElement('button');
        excluir.type = 'button'; excluir.className = 'btn btn-outline-danger btn-sm'; excluir.textContent = 'Excluir';
        let confirmado = false;
        excluir.onclick = () => {
          if (confirmado) excluirRascunho(r.id);
          else { confirmado = true; excluir.textContent = 'Toque de novo para excluir'; }
        };
        const acoes = document.createElement('div');
        acoes.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
        acoes.append(continuar, excluir);
        item.append(info, acoes);
        itens.append(item);
      }
    };
    return desenhar;
  }

  function rascunhosNoGlpi() {
    const desenharPagina = naPaginaRascunhos() ? paginaRascunhos() : null;
    atualizarRascunhos = () => { menuRascunhos(); desenharPagina?.(); };
    window.addEventListener('focus', atualizarRascunhos);
    // O menu pode ser montado depois do script.
    observar(menuRascunhos);
    atualizarRascunhos();
  }

  function observar(acao) {
    let agendado = false;
    const agendar = () => {
      if (agendado) return;
      agendado = true;
      setTimeout(() => { agendado = false; acao(); }, 50);
    };
    new MutationObserver(agendar).observe(document.documentElement, { childList: true, subtree: true });
    agendar();
  }

  function faixa(mensagem) {
    document.getElementById('vx-glpi-aviso')?.remove();
    const el = document.createElement('div');
    el.id = 'vx-glpi-aviso';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:10px;left:12px;right:12px;z-index:2147483647;padding:12px 44px 12px 16px;border:1px solid #64748b;border-radius:6px;background:#eef2f6;color:#172033;font:14px/1.5 system-ui,sans-serif;box-shadow:0 3px 12px #0003;max-height:35vh;overflow:auto;color-scheme:light';
    const conteudo = document.createElement('span');
    conteudo.textContent = mensagem;
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.textContent = '×';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.style.cssText = 'position:absolute;right:8px;top:6px;background:transparent;border:0;color:inherit;font:24px system-ui;cursor:pointer';
    fechar.onclick = () => el.remove();
    el.append(conteudo, fechar);
    document.body.appendChild(el);
  }

  let carregamentoGlpi;
  function mostrarCarregamento(mensagem) {
    if (carregamentoGlpi) { carregamentoGlpi.mensagem.textContent = mensagem; return; }
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    const ocupadoAnterior = document.body.getAttribute('aria-busy');
    const camada = document.createElement('div');
    camada.id = 'vx-glpi-carregando';
    camada.setAttribute('role', 'dialog');
    camada.setAttribute('aria-modal', 'true');
    camada.setAttribute('aria-labelledby', 'vx-glpi-carregando-titulo');
    camada.setAttribute('aria-describedby', 'vx-glpi-carregando-mensagem');
    camada.tabIndex = -1;
    camada.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.42);box-sizing:border-box';
    camada.innerHTML = '<style>@keyframes vx-glpi-girar{to{transform:rotate(360deg)}}#vx-glpi-carregando .vx-glpi-spinner{width:32px;height:32px;box-sizing:border-box;border:3px solid var(--tblr-border-color,#dce1e7);border-top-color:var(--tblr-primary,#206bc4);border-radius:50%;animation:vx-glpi-girar .8s linear infinite;margin:0 auto 20px}@media(prefers-reduced-motion:reduce){#vx-glpi-carregando .vx-glpi-spinner{animation:none}}</style><div style="width:100%;max-width:360px;padding:32px 24px;box-sizing:border-box;border-radius:8px;background:var(--tblr-bg-surface,var(--tblr-body-bg,#fff));color:var(--tblr-body-color,#182433);box-shadow:0 12px 32px rgba(0,0,0,.16);text-align:center;font-family:inherit"><div class="vx-glpi-spinner" aria-hidden="true"></div><p id="vx-glpi-carregando-titulo" style="font-size:18px;font-weight:600;line-height:1.35;margin:0 0 8px">Preparando chamado</p><p id="vx-glpi-carregando-mensagem" role="status" aria-live="polite" aria-atomic="true" style="font-size:14px;line-height:1.5;margin:0"></p></div>';
    const mensagemEl = camada.querySelector('#vx-glpi-carregando-mensagem');
    mensagemEl.textContent = mensagem;
    const bloqueados = new Set();
    const bloquear = () => [...document.body.children].forEach((el) => {
      if (el !== camada && !el.hasAttribute('inert')) { el.setAttribute('inert', ''); bloqueados.add(el); }
    });
    document.body.appendChild(camada);
    document.body.style.overflow = 'hidden';
    document.body.setAttribute('aria-busy', 'true');
    bloquear();
    const observador = new MutationObserver(bloquear);
    observador.observe(document.body, { childList: true });
    camada.focus();
    window.addEventListener('pagehide', ocultarCarregamento, { once: true });
    carregamentoGlpi = { mensagem: mensagemEl, fechar() {
      window.removeEventListener('pagehide', ocultarCarregamento);
      observador.disconnect();
      bloqueados.forEach((el) => el.removeAttribute('inert'));
      camada.remove();
      document.body.style.overflow = overflowAnterior;
      if (ocupadoAnterior === null) document.body.removeAttribute('aria-busy');
      else document.body.setAttribute('aria-busy', ocupadoAnterior);
      if (focoAnterior?.isConnected) focoAnterior.focus();
    } };
  }

  function ocultarCarregamento() {
    carregamentoGlpi?.fechar();
    carregamentoGlpi = null;
  }

  // ── 2. Vortex: identifica a visita antes do React abrir o detalhe ─────────
  // Abre o GLPI no clique e entrega os dados após confirmar a visita no servidor.
  async function lancarVisita(id, conferir) {
    const entrega = pagina.crypto.randomUUID();
    const chave = 'vxGlpiEntrega:' + entrega;
    const rascunhoAtual = rascunhoDaVisita(id);
    const entidade = rascunhoAtual?.campos?.entities_id?.value || ENTIDADE;
    const url = `${URL_GLPI}?entities_id=${encodeURIComponent(entidade)}&type=${TIPO}&status=${STATUS}&itilcategories_id=${CATEGORIA_PADRAO}#vx_aguardar=${entrega}`;
    const aba = window.open(url, '_blank');
    if (!aba) { faixa('Permita abrir novas guias para lançar a visita no GLPI.'); return; }
    const entregar = (resultado) => GM_setValue(chave, { ...resultado, em: Date.now() });
    try {
      const resposta = await fetch('/api/visitas/' + encodeURIComponent(id), { credentials: 'same-origin' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      const visita = await resposta.json();
      if (!visita || visita.id !== id || !texto(visita.unidade)) throw new Error('Visita sem dados sincronizados');
      if (conferir && !conferir(visita)) {
        const erro = 'Não consegui confirmar qual visita está aberta. Feche e abra a visita pela lista.';
        entregar({ erro });
        faixa(erro);
        return;
      }
      const chamado = GM_getValue('vxGlpiLancados', {})[id];
      if (/^\d+$/.test(String(chamado))) { entregar({ chamado }); return; }
      let rascunho = rascunhoDaVisita(id);
      if (!rascunho) {
        rascunho = novoRascunho({ origem: 'vortex', visitId: texto(id), lancamento: montarLancamento(visita) });
        guardarRascunhos({ ...rascunhos(), [rascunho.id]: rascunho });
      }
      // A aba de destino prepara a retomada; não publica ordens globais antes dela receber a entrega.
      entregar({ rascunho });
    } catch (erro) {
      registrar('buscar visita', erro);
      entregar({ erro: 'Não foi possível buscar a ficha no Vortex. Confira a conexão e se a visita foi sincronizada.' });
      faixa('Visita ainda não sincronizada ou sem internet');
    }
  }

  // Ao finalizar a ficha, o app faz POST /api/visitas e recebe a visita salva.
  // Só oferece se o POST partiu da Nova Visita: o reenvio da fila offline ao
  // abrir o app passa pelo mesmo fetch e não deve abrir cartão nenhum.
  function oferecerAoFinalizar() {
    const fetchOriginal = pagina.fetch;
    pagina.fetch = async function (entrada, opcoes) {
      let finalizando = false;
      try {
        const url = new URL(typeof entrada === 'string' ? entrada : entrada.url, location.href);
        const metodo = String(opcoes?.method || entrada?.method || 'GET').toUpperCase();
        finalizando = metodo === 'POST' && url.pathname === '/api/visitas' && location.pathname.startsWith('/nova-visita');
      } catch { /* entrada incomum: só repassa */ }
      const resposta = await fetchOriginal.apply(this, arguments);
      if (finalizando && resposta.ok) {
        resposta.clone().json()
          .then((visita) => { if (visita?.id && !visita._queued) cartaoFinalizada(visita); })
          .catch((erro) => registrar('ler visita finalizada', erro));
      }
      return resposta;
    };
  }

  function cartaoFinalizada(visita) {
    if (/^\d+$/.test(String(GM_getValue('vxGlpiLancados', {})[visita.id]))) return;
    document.querySelector('[data-testid="vx-glpi-finalizada"]')?.remove();
    const cartao = document.createElement('div');
    cartao.setAttribute('data-testid', 'vx-glpi-finalizada');
    cartao.className = 'rounded-lg border bg-background p-4 shadow-lg text-foreground space-y-3';
    cartao.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;max-width:420px;margin:0 auto;z-index:2147483646';
    cartao.innerHTML = '<p class="text-sm font-semibold">Visita registrada</p>' +
      '<p class="text-xs text-muted-foreground" data-vx="unidade"></p>' +
      '<div class="flex gap-2"></div>';
    cartao.querySelector('[data-vx="unidade"]').textContent = `${visita.unidade || ''} · ${visita.data || ''}`;
    const botoes = cartao.querySelector('.flex');
    const botao = (rotulo, classes, acao) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-3 ' + classes;
      b.textContent = rotulo;
      b.addEventListener('click', acao);
      botoes.appendChild(b);
    };
    botao('Lançar no GLPI', 'bg-primary text-primary-foreground', () => { cartao.remove(); lancarVisita(visita.id); });
    botao('Agora não', 'hover:bg-accent', () => cartao.remove());
    document.body.appendChild(cartao);
  }

  // ── 2b. "GLPI pendente" na nuvenzinha ─────────────────────────────────────
  // A marca confirma; horário e unidade só sugerem chamados antigos.
  const MAX_ITENS = 5;
  let cacheVisitas = null;
  let buscaVisitas = null;
  let tentativaVisitas = 0;
  let atualizarPendentes = () => {};
  const horaLocal = (em) => new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function chamadoProvavel(visita) {
    const dia = dataIso(visita.data);
    const abertura = dataAbertura(visita.data, visita.horaInicio).slice(0, 16);
    const unidade = normalizar(visita.unidade);
    if (!dia || !abertura || !unidade) return null;
    const descartes = GM_getValue('vxGlpiDescartesProvaveis', {})[visita.id] || [];
    return GM_getValue('vxGlpiChamadosRecentes', []).find((c) =>
      c.aberturaIso === abertura && normalizar(c.localizacao).split('>').pop().trim() === unidade && !descartes.includes(c.id));
  }

  function inicioDoControle() {
    let desde = Number(GM_getValue('vxGlpiDesde', 0));
    if (!desde) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      desde = hoje.getTime();
      GM_setValue('vxGlpiDesde', desde);
    }
    return desde;
  }

  async function usuarioAtual() {
    try {
      const resposta = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const id = (await resposta.json())?.user?.id;
      if (id) return id;
    } catch { /* offline: usa a sessão guardada pelo app */ }
    try { return JSON.parse(localStorage.getItem('vt_offline_session') || 'null')?.user?.id || null; } catch { return null; }
  }

  async function listaVisitas() {
    if (cacheVisitas && Date.now() - cacheVisitas.em < 2 * 60 * 1000) return cacheVisitas.visitas;
    if (buscaVisitas) return buscaVisitas;
    // Mutações também chegam offline; não repetir a falha a cada desenho.
    if (Date.now() - tentativaVisitas < 2 * 60 * 1000) return cacheVisitas?.visitas || null;
    tentativaVisitas = Date.now();
    buscaVisitas = (async () => {
      const resposta = await fetch('/api/visitas', { credentials: 'same-origin' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      cacheVisitas = { em: Date.now(), visitas: await resposta.json() };
      return cacheVisitas.visitas;
    })().finally(() => { buscaVisitas = null; });
    return buscaVisitas;
  }

  async function fichasPendentes() {
    const visitas = await listaVisitas();
    if (!visitas) throw new Error('Lista de visitas indisponível');
    const eu = await usuarioAtual();
    if (!eu) throw new Error('Usuário não identificado');
    const desde = inicioDoControle();
    const lancados = GM_getValue('vxGlpiLancados', {});
    return visitas
      .filter((v) => v && v.tecnicoId === eu && !v.deletedAt && !v._queued && !(v.id in lancados) && Date.parse(v.createdAt) >= desde)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function etiquetasDasVisitas() {
    if (location.pathname !== '/minhas-visitas') return;
    const linhas = [...document.querySelectorAll('tr[data-testid^="row-my-visit-"]')];
    if (!linhas.length) return;
    let visitas;
    try { visitas = await listaVisitas(); } catch { /* offline: as marcas e rascunhos bastam */ }
    if (location.pathname !== '/minhas-visitas') return;
    const porId = new Map((visitas || []).map((v) => [v.id, v]));
    const lancados = GM_getValue('vxGlpiLancados', {});
    const verde = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    for (const linha of linhas) {
      const id = linha.dataset.testid.slice('row-my-visit-'.length);
      const celula = linha.cells[4];
      let etiqueta = linha.querySelector('[data-vx-glpi-etiqueta]');
      const visita = porId.get(id);
      let rotulo = '', cores = '', titulo = '', acao = null;
      if (celula && !linha.classList.contains('opacity-50') &&
          [...linha.querySelectorAll('[data-testid]')].some((el) => el.dataset.testid === 'button-view-visita-' + id)) {
        const numero = lancados[id];
        const provavel = visita && chamadoProvavel(visita);
        if (/^\d+$/.test(String(numero))) {
          rotulo = `GLPI #${numero}`; cores = verde;
          acao = () => window.open(URL_GLPI + '?id=' + numero, '_blank');
        } else if (numero === 'manual') {
          rotulo = 'GLPI lançada'; cores = verde;
        } else if (provavel) {
          rotulo = `Provável #${provavel.id}`;
          cores = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
          titulo = 'Confirme na nuvenzinha';
          acao = () => window.open(URL_GLPI + '?id=' + provavel.id, '_blank');
        } else if (rascunhoDaVisita(id)) {
          rotulo = 'Rascunho GLPI'; cores = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
          acao = () => lancarVisita(id);
        } else if (visita && Date.parse(visita.createdAt) >= inicioDoControle()) {
          rotulo = 'GLPI pendente'; cores = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800';
          acao = () => lancarVisita(id);
        } else if (visita) {
          rotulo = 'GLPI ?'; cores = 'bg-muted text-muted-foreground border-border';
          titulo = 'Antes do controle: confira no GLPI ou marque na nuvenzinha';
        }
      }
      if (!rotulo) { etiqueta?.remove(); continue; }
      if (!etiqueta) {
        etiqueta = document.createElement('span');
        etiqueta.setAttribute('data-vx-glpi-etiqueta', '');
        celula.appendChild(etiqueta);
      }
      // Só altera o necessário para o observador não alimentar a si mesmo.
      if (etiqueta.textContent !== rotulo) etiqueta.textContent = rotulo;
      const classes = 'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ml-1 whitespace-nowrap ' + (acao ? 'cursor-pointer ' : 'cursor-default ') + cores;
      if (etiqueta.className !== classes) etiqueta.className = classes;
      if (etiqueta.title !== titulo) etiqueta.title = titulo;
      etiqueta.onclick = (e) => { e.stopPropagation(); acao?.(); };
    }
  }

  async function caixaPendentes(popover) {
    popover.setAttribute('data-vx-glpi', '');
    const alvo = popover.querySelector('.space-y-3') || popover;
    const caixa = document.createElement('div');
    caixa.className = 'rounded-md border bg-muted/40 p-2 space-y-2';
    caixa.setAttribute('data-testid', 'vx-glpi-pendentes');
    const titulo = document.createElement('p');
    titulo.className = 'text-xs font-medium';
    titulo.textContent = 'GLPI pendente: verificando…';
    caixa.appendChild(titulo);
    alvo.appendChild(caixa);

    let fichas;
    try { fichas = await fichasPendentes(); }
    catch (erro) { registrar('fichas pendentes', erro); titulo.textContent = 'GLPI pendente: sem conexão para verificar'; return; }

    const desenhar = () => {
      const lancados = GM_getValue('vxGlpiLancados', {});
      fichas = fichas.filter((v) => !(v.id in lancados));
      caixa.querySelectorAll('[data-vx="item"], [data-vx="nota"]').forEach((el) => el.remove());
      const desde = new Date(inicioDoControle()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      titulo.textContent = fichas.length ? `GLPI pendente: ${fichas.length} ficha${fichas.length > 1 ? 's' : ''}` : `GLPI em dia (fichas desde ${desde})`;
      for (const visita of fichas.slice(0, MAX_ITENS)) {
        const item = document.createElement('div');
        item.setAttribute('data-vx', 'item');
        item.className = 'flex items-start gap-2';
        item.innerHTML = '<p class="text-xs text-muted-foreground flex-1"></p>';
        item.firstChild.textContent = `${visita.unidade} · ${String(visita.data || '').slice(0, 5)} ${visita.horaInicio || ''}`;
        const acao = (rotulo, classes, fazer) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'text-xs font-medium hover:underline ' + classes;
          b.textContent = rotulo;
          b.addEventListener('click', fazer);
          item.appendChild(b);
        };
        const provavel = chamadoProvavel(visita);
        const confirmar = (numero) => {
          const lancados = GM_getValue('vxGlpiLancados', {});
          lancados[visita.id] = numero;
          GM_setValue('vxGlpiLancados', lancados);
          fichas = fichas.filter((f) => f.id !== visita.id);
          desenhar();
        };
        if (provavel) {
          item.firstChild.textContent += ` · provável #${provavel.id}`;
          acao('Confirmar', 'text-primary', () => confirmar(provavel.id));
          acao('Não é', 'text-muted-foreground', () => {
            const descartes = GM_getValue('vxGlpiDescartesProvaveis', {});
            descartes[visita.id] = [...new Set([...(descartes[visita.id] || []), provavel.id])];
            GM_setValue('vxGlpiDescartesProvaveis', descartes);
            desenhar();
          });
        } else {
          acao(rascunhoDaVisita(visita.id) ? 'Continuar' : 'Lançar', 'text-primary', async () => { await lancarVisita(visita.id); desenhar(); });
          acao('Já lancei', 'text-muted-foreground', () => confirmar('manual'));
        }
        caixa.appendChild(item);
      }
      const nota = document.createElement('p');
      nota.setAttribute('data-vx', 'nota');
      nota.className = 'text-xs text-muted-foreground';
      const resto = fichas.length - MAX_ITENS;
      const em = GM_getValue('vxGlpiSincronizadoEm', 0);
      nota.textContent = (resto > 0 ? `+${resto} mais. ` : '') + (em ? `Sincronizado com o GLPI às ${horaLocal(em)}` : 'Abra o GLPI para sincronizar');
      caixa.appendChild(nota);
    };
    atualizarPendentes = () => { if (caixa.isConnected) desenhar(); };
    desenhar();
  }

  function abrirFichaDaUrl() {
    const parametros = new URL(location.href).searchParams;
    const id = parametros.get('vx_ficha');
    const busca = texto(parametros.get('busca'));
    if (location.pathname !== '/historico' || !id) return;
    let debounce;
    let encerrado = false;
    let buscaPreenchida = !busca;
    const encerrar = () => {
      encerrado = true;
      observador.disconnect();
      clearTimeout(debounce);
      clearTimeout(limite);
    };
    const procurar = () => {
      if (encerrado) return;
      if (!buscaPreenchida) {
        const campo = document.querySelector('input#historico-busca, input[data-testid="input-busca"]');
        if (campo) {
          buscaPreenchida = true;
          // O setter nativo permite que o onChange do input controlado reconheça a alteração.
          Object.getOwnPropertyDescriptor(pagina.HTMLInputElement.prototype, 'value').set.call(campo, busca);
          campo.dispatchEvent(new pagina.Event('input', { bubbles: true }));
          // A consulta pode renderizar os cartões depois do debounce de 300 ms.
          debounce = setTimeout(procurar, 400);
        }
      }
      // No Histórico o cartão abre o detalhe; a linha sozinha não tem handler.
      // O Histórico usa o id operacional "visita:<id>" nas fichas avulsas.
      const prefixos = ['card-visita-visita:', 'card-visita-', 'button-view-visita-', 'row-my-visit-'];
      const elementos = [...document.querySelectorAll('[data-testid]')];
      const alvo = prefixos.map((p) => elementos.find((el) => el.dataset.testid === p + id)).find(Boolean);
      if (!alvo) return;
      encerrar();
      alvo.click();
      const url = new URL(location.href);
      url.searchParams.delete('vx_ficha');
      history.replaceState(history.state, '', url.href);
    };
    const observador = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(procurar, 80); });
    observador.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'] });
    const limite = setTimeout(() => {
      encerrar();
      faixa('Ficha não encontrada nesta lista. Confira a data ou se você tem acesso ao Histórico.');
    }, 20000);
    procurar();
  }

  function iniciarVortex() {
    oferecerAoFinalizar();
    inicioDoControle();
    observar(() => {
      const popover = document.querySelector('[data-testid="popover-offline-status"]:not([data-vx-glpi])');
      if (popover) caixaPendentes(popover);
    });
    let visitId = '';
    const prefixos = ['row-my-visit-', 'button-view-visita-', 'card-visita-'];
    document.addEventListener('click', (e) => {
      const alvo = e.target.closest?.('[data-testid^="row-my-visit-"],[data-testid^="button-view-visita-"],[data-testid^="card-visita-"]');
      if (!alvo) return;
      const testid = alvo.getAttribute('data-testid');
      const prefixo = prefixos.find((p) => testid.startsWith(p));
      visitId = testid.slice(prefixo.length).replace(/^visita:/, '');
      atualizarBotoes();
    }, true);

    function atualizarBotoes() {
      const lancados = GM_getValue('vxGlpiLancados', {});
      for (const imprimir of document.querySelectorAll('[data-testid="button-visit-print"]')) {
        let botao = imprimir.parentElement.querySelector('[data-testid="vx-lancar-glpi"]');
        if (!botao) {
          botao = document.createElement('button');
          botao.type = 'button';
          botao.setAttribute('data-testid', 'vx-lancar-glpi');
          botao.className = imprimir.className;
          imprimir.before(botao);
          botao.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!visitId) { faixa('Abra a visita pela lista para identificar o lançamento.'); return; }
            botao.disabled = true;
            // O id vem do último clique na lista; o detalhe pode ter sido aberto
            // por outro caminho. Só segue se o diálogo mostra a mesma unidade e data.
            const dialogo = normalizar((imprimir.closest('[role="dialog"]') || document.body).textContent);
            await lancarVisita(visitId, (visita) => dialogo.includes(normalizar(visita.unidade)) && dialogo.includes(normalizar(visita.data)));
            botao.disabled = false;
          });
        }
        const numero = lancados[visitId];
        const rotulo = /^\d+$/.test(String(numero)) ? `Abrir chamado #${numero}` : 'Lançar no GLPI';
        if (botao.textContent !== rotulo) botao.textContent = rotulo;
      }
    }
    observar(atualizarBotoes);
    observar(etiquetasDasVisitas);
    window.addEventListener('focus', () => { atualizarBotoes(); atualizarPendentes(); etiquetasDasVisitas(); });
    abrirFichaDaUrl();
  }

  // ── 3. GLPI: usa a configuração viva, inclusive os tokens da sessão ───────
  const INTERVALO_SYNC = 10 * 60 * 1000;
  let sincronizacaoEmCurso = null;

  function lerChamados(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form[data-search-itemtype="Ticket"]');
    if (!form || !/^\d+$/.test(form.dataset.count || '')) throw new Error('Busca indisponível ou sessão expirada');
    doc.querySelectorAll('script, style').forEach((el) => el.remove());
    const tabela = form.querySelector('th[data-searchopt-id="2"]')?.closest('table');
    const total = Number(form.dataset.count);
    if (!tabela) {
      if (!total) return { chamados: [], total, limite: Number(form.dataset.limit) };
      throw new Error('Busca sem tabela de chamados');
    }
    const colunas = [...tabela.querySelectorAll('thead th')];
    const indice = (campo) => colunas.findIndex((th) => th.dataset.searchoptId === String(campo));
    if ([2, 21, 15, 83].some((campo) => indice(campo) < 0)) throw new Error('Busca sem as colunas necessárias');
    const chamados = [...tabela.tBodies].flatMap((body) => [...body.rows]).map((tr) => {
      const celula = (campo) => texto(tr.cells[indice(campo)]?.textContent);
      const id = Number(celula(2).replace(/\s/g, ''));
      const data = /^(\d{2})[-/](\d{2})[-/](\d{4})\s+(\d{2}:\d{2})/.exec(celula(15));
      const aberturaIso = data ? `${data[3]}-${data[2]}-${data[1]} ${data[4]}` : celula(15).slice(0, 16);
      // O texto completo fica no tooltip, mesmo quando a célula é abreviada.
      const descricao = celula(21);
      const visitas = [...descricao.matchAll(/Ficha Vortex\b[\s\S]*?\b(v_[a-z0-9]+_[a-z0-9]+)\b/g)].map((m) => m[1]);
      return { id, aberturaIso, localizacao: celula(83), visitas };
    }).filter((c) => Number.isSafeInteger(c.id) && c.id > 0);
    return { chamados, total, limite: Number(form.dataset.limit) };
  }

  function sincronizarGlpi(forcar = false) {
    if (sincronizacaoEmCurso) return sincronizacaoEmCurso;
    const token = document.querySelector('meta[property="glpi:csrf_token"]')?.content || document.querySelector('input[name="_glpi_csrf_token"]')?.value;
    if (!token) return Promise.resolve();
    const agora = Date.now();
    // A cópia síncrona cobre recargas/guias enquanto o GM termina de gravar.
    let tentativaLocal = 0;
    try { tentativaLocal = Number(localStorage.getItem('vxGlpiTentativaEm')); } catch { /* usa GM */ }
    const ultima = Math.max(tentativaLocal, Number(GM_getValue('vxGlpiTentativaEm', 0)), Number(GM_getValue('vxGlpiSincronizadoEm', 0)));
    if (!forcar && agora - ultima < INTERVALO_SYNC) return Promise.resolve();
    try { localStorage.setItem('vxGlpiTentativaEm', String(agora)); } catch { /* usa GM */ }
    GM_setValue('vxGlpiTentativaEm', agora);
    sincronizacaoEmCurso = (async () => {
      try {
        const desde = new Date(inicioDoControle());
        desde.setDate(desde.getDate() - 60);
        const dia = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-${String(desde.getDate()).padStart(2, '0')}`;
        const encontrados = new Map();
        // Consultas planas preservam o OR entre requerente e técnico sem agrupar filtros.
        for (const ator of [4, 5]) {
          for (const filtro of [{ field: 21, searchtype: 'contains', value: 'Ficha Vortex' }, { field: 15, searchtype: 'morethan', value: dia }]) {
            let inicio = 0;
            for (let paginaBusca = 0; ; paginaBusca++) {
              if (paginaBusca >= 100) throw new Error('Busca incompleta: mais de 100 páginas');
              const params = new URLSearchParams({ action: 'display_results', searchform_id: 'search_vortex_glpi', itemtype: 'Ticket', glpilist_limit: '200', is_deleted: '0', as_map: '0', browse: '0', start: String(inicio), _glpi_csrf_token: token });
              params.append('sort[]', '15'); params.append('order[]', 'DESC');
              for (const campo of [2, 21, 15, 83]) params.append('forcedisplay[]', String(campo));
              for (const [n, criterio] of [{ ...filtro, link: 'AND' }, { field: ator, searchtype: 'equals', value: 'myself', link: 'AND' }].entries()) {
                for (const [chave, valor] of Object.entries(criterio)) params.set(`criteria[${n}][${chave}]`, String(valor));
              }
              const controle = new AbortController();
              const limite = setTimeout(() => controle.abort(), 15000);
              let resultado;
              try {
                const resposta = await fetch('/ajax/search.php?' + params, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal: controle.signal });
                if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
                resultado = lerChamados(await resposta.text());
              } finally { clearTimeout(limite); }
              for (const c of resultado.chamados) encontrados.set(c.id, c);
              const passo = resultado.limite;
              if (inicio + passo >= resultado.total || !resultado.total) break;
              if (!(passo > 0) || !resultado.chamados.length) throw new Error('Paginação incompleta');
              inicio += passo;
            }
          }
        }
        const lancados = GM_getValue('vxGlpiLancados', {});
        const recentes = [];
        const chamados = [...encontrados.values()].sort((a, b) => b.aberturaIso.localeCompare(a.aberturaIso) || b.id - a.id);
        for (const c of chamados) {
          for (const id of c.visitas) {
            if (/^\d+$/.test(String(lancados[id])) && Number(lancados[id]) !== c.id) {
              registrar('marca duplicada: vínculo preservado', id);
              continue;
            }
            lancados[id] = c.id;
          }
          if (!c.visitas.length && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(c.aberturaIso) && c.aberturaIso >= dia + ' 00:00') {
            recentes.push({ id: c.id, aberturaIso: c.aberturaIso, localizacao: c.localizacao });
          }
        }
        await GM_setValue('vxGlpiLancados', lancados);
        await GM_setValue('vxGlpiChamadosRecentes', recentes.slice(0, 300));
        await GM_setValue('vxGlpiSincronizadoEm', Date.now());
      } catch (erro) { registrar('sincronizar chamados', erro); }
    })().finally(() => { sincronizacaoEmCurso = null; atualizarRascunhos(); });
    atualizarRascunhos();
    return sincronizacaoEmCurso;
  }

  function esperar(obter, limite = 15000) {
    return new Promise((ok, falhar) => {
      const inicio = Date.now();
      const tentar = () => {
        try {
          const valor = obter();
          if (valor) { ok(valor); return; }
          if (Date.now() - inicio >= limite) { falhar(new Error('Campo/editor indisponível após 15 s')); return; }
          setTimeout(tentar, 50);
        } catch (erro) { falhar(erro); }
      };
      tentar();
    });
  }

  function selecionar(campo, id, rotulo) {
    if (String(campo.value) === String(id)) return false;
    if (![...campo.options].some((o) => String(o.value) === String(id))) campo.add(new Option(rotulo, String(id), true, true));
    pagina.jQuery(campo).val(String(id)).trigger('change');
    return true;
  }

  function achatar(resultados) {
    return (resultados || []).flatMap((r) => r.children ? achatar(r.children) : [r]).filter((r) => !r.disabled && r.id != null);
  }

  async function buscar(campo, termo) {
    const $ = pagina.jQuery;
    const ajax = await esperar(() => $(campo).data('select2')?.options.get('ajax'));
    const params = { term: termo, page: 1, _type: 'query' };
    const dados = typeof ajax.data === 'function' ? ajax.data.call($(campo), params) : { ...ajax.data, searchText: termo };
    const url = typeof ajax.url === 'function' ? ajax.url.call($(campo), params) : ajax.url;
    // Paginar evita decidir por um resultado parcial ou ignorar o usuário logado.
    const encontrados = [];
    for (let numero = 1; numero <= 20; numero++) {
      const resposta = await $.ajax({ url, type: ajax.type || 'GET', dataType: 'json', data: { ...dados, page: numero }, timeout: 10000 });
      const processada = ajax.processResults ? ajax.processResults(resposta, { ...params, page: numero }) : resposta;
      encontrados.push(...achatar(processada.results));
      if (!processada.pagination?.more) return encontrados;
    }
    throw new Error('Consulta incompleta: mais de 20 páginas');
  }

  function escolherLocalizacao(resultados, unidade) {
    const nome = normalizar(unidade);
    if (!nome) return null;
    const exatos = resultados.filter((r) => normalizar(r.text).endsWith('> ' + nome) || normalizar(r.text) === nome);
    if (exatos.length === 1) return exatos[0];
    if (exatos.length > 1) return null;
    const parciais = resultados.filter((r) => normalizar(r.text).includes(nome));
    return parciais.length === 1 ? parciais[0] : null;
  }

  function categoriaCompativel(resultado, modulo) {
    const caminho = normalizar(resultado.text);
    if (!caminho.startsWith('ti > sistemas > saude simples >')) return false;
    const nome = caminho.split('>').pop().trim();
    const alvo = normalizar(modulo);
    return nome === alvo || (alvo === 'prontuario' && nome === 'prontuario eletronico') || (alvo === 'prontuario eletronico' && nome === 'prontuario');
  }

  function capturarAtores(form) {
    const atores = JSON.parse(form.querySelector('#_actors').value);
    return Object.fromEntries(TIPOS_ATOR.map((tipo) => {
      const campo = form.querySelector(`select[data-actor-type="${tipo}"]`);
      const dados = pagina.jQuery(campo).select2('data');
      return [tipo, (atores[tipo] || []).map((a, i) => {
        const id = `${a.itemtype}_${a.items_id}`;
        const dado = dados.find((d) => d.id === id) || dados[i];
        // O select2 nem sempre tem o nome (atores postos pelo modelo/categoria);
        // o <option> e o selo desenhado são as outras fontes.
        const opcao = [...campo.options].find((o) => o.value === id);
        const selo = campo.nextElementSibling?.querySelector(`.actor_entry[data-itemtype="${a.itemtype}"][data-items-id="${a.items_id}"]`);
        const nome = texto(dado?.text) || texto(opcao?.dataset.text) || texto(opcao?.textContent) || texto(selo?.textContent);
        // O selo de grupo selecionado mostra o title ("Operação > Sistemas Guarujá"), não o nome.
        const titulo = texto(dado?.title) || texto(opcao?.dataset.title) || texto(opcao?.title);
        return { ...a, id: dado?.id || id, text: nome, title: titulo };
      })];
    }));
  }

  function capturarCampos(form) {
    const campo = (nome) => form.querySelector(`[name="${nome}"]`);
    const content = pagina.tinymce?.get(campo('content').id)?.getContent() ?? campo('content').value;
    return {
      name: campo('name').value, content,
      ...Object.fromEntries(SELECTS_RASCUNHO.map((nome) => {
        const el = campo(nome);
        return [nome, { value: el.value, text: pagina.jQuery(el).select2('data')[0]?.text || '' }];
      })),
      date: campo('date').value, atores: capturarAtores(form),
    };
  }

  function definirData(el, valor) {
    const calendario = el.closest('.flatpickr')?._flatpickr || el._flatpickr;
    if (calendario) calendario.setDate(valor, true, 'Y-m-d H:i:S');
    else { el.value = valor; el.dispatchEvent(new Event('change', { bubbles: true })); }
    if (el.value !== valor) throw new Error('Valor não aceito: ' + el.value);
  }

  async function definirConteudo(el, html) {
    const editor = await esperar(() => {
      const ed = pagina.tinymce?.get(el.id);
      return ed?.initialized && ed;
    });
    if (editor.getContent() !== html) {
      editor.setContent(html);
      editor.save();
      editor.fire('change');
    }
  }

  async function aplicarAtores(form, tipo, lista) {
    const $ = pagina.jQuery;
    const campo = form.querySelector(`select[data-actor-type="${tipo}"]`);
    if (!campo) throw new Error('Ator não encontrado: ' + tipo);
    await esperar(() => $(campo).data('select2'));
    const selecionados = () => $(campo).val() || [];
    // Sem nome o selo do GLPI fica só com o ícone: busca o nome atual no
    // próprio GLPI e, se não achar, mostra "Grupo 9" / "Usuário 304".
    // Grupo selecionado é desenhado pelo title; rascunhos antigos não o guardavam.
    const incompleto = (a) => !texto(a.text) || (a.itemtype === 'Group' && !texto(a.title));
    if (lista.some(incompleto)) {
      let resultados = [];
      try {
        resultados = await buscar(campo, '');
        if (lista.some((a) => a.itemtype === 'Group' && !resultados.some((r) => r.id === a.id))) resultados.push(...await buscar(campo, 'guaruja'));
      } catch (erro) { registrar('nomes dos atores', erro); }
      lista = lista.map((a) => {
        if (!incompleto(a)) return a;
        const achado = resultados.find((r) => r.id === a.id);
        const nome = texto(a.text) || texto(achado?.text) || `${a.itemtype === 'Group' ? 'Grupo' : 'Usuário'} ${a.items_id}`;
        return { ...a, text: nome, title: texto(a.title) || texto(achado?.title) || nome };
      });
    }
    // O requester nativo envia o template; durante a restauração só sincroniza actors.
    const descritor = Object.getOwnPropertyDescriptor(form, 'submit');
    Object.defineProperty(form, 'submit', { configurable: true, value: () => {} });
    try {
      for (const dado of $(campo).select2('data')) {
        if (lista.some((a) => a.id === dado.id)) continue;
        $(campo).val(selecionados().filter((id) => id !== dado.id)).trigger('change');
        $(campo).trigger({ type: 'select2:unselect', params: { data: dado } });
      }
      for (const dado of lista) {
        const ids = [...new Set([...selecionados(), dado.id])];
        // Recriar a opção também descarta metadados antigos no cache do select2.
        $(campo).find('option').filter((_, o) => o.value === dado.id).remove();
        const opcao = new Option(dado.text, dado.id, true, true);
        for (const chave of ['itemtype', 'items_id', 'use_notification', 'default_email', 'alternative_email', 'text', 'title']) {
          const nome = chave.replace(/_/g, '-');
          const valor = dado[chave] ?? (chave === 'use_notification' ? false : '');
          opcao.setAttribute('data-' + nome, String(valor));
          $(opcao).data(nome, valor);
        }
        campo.add(opcao);
        $(campo).val(ids).trigger('change');
        $(campo).trigger({ type: 'select2:select', params: { data: dado } });
      }
    } finally {
      if (descritor) Object.defineProperty(form, 'submit', descritor);
      else delete form.submit;
    }
  }

  async function preencherAtores(form) {
    const $ = pagina.jQuery;
    const campo = form.querySelector('select[data-actor-type="assign"]');
    if (!campo) throw new Error('Atribuído não encontrado');
    const atores = JSON.parse(form.querySelector('#_actors').value);
    const usuario = atores.requester.find((a) => a.itemtype === 'User' && Number(a.items_id) > 0);
    if (!usuario) throw new Error('Usuário logado ausente no requerente padrão');
    await esperar(() => $(campo).data('select2'));
    const idUsuario = 'User_' + usuario.items_id;
    const idGrupo = 'Group_' + GRUPO_SISTEMAS;
    const lista = capturarAtores(form).assign.filter((a) => a.id !== 'Group_' + GRUPO_SERVICE_DESK);
    const faltantes = [idUsuario, idGrupo].filter((id) => !lista.some((a) => a.id === id));
    if (faltantes.length) {
      const resultados = await buscar(campo, '');
      if (!resultados.some((a) => a.id === idGrupo)) resultados.push(...await buscar(campo, 'guaruja'));
      for (const id of faltantes) {
        const dado = resultados.find((a) => a.id === id);
        if (!dado) { registrar('ator ausente', id); continue; }
        lista.push(dado);
      }
    }
    await aplicarAtores(form, 'assign', lista);
    const atual = JSON.parse(form.querySelector('#_actors').value).assign;
    if (![idUsuario, idGrupo].every((id) => atual.some((a) => `${a.itemtype}_${a.items_id}` === id)) || atual.some((a) => a.itemtype === 'Group' && Number(a.items_id) === GRUPO_SERVICE_DESK)) {
      throw new Error('Atribuído incompleto; confira usuário logado + Sistemas Guarujá');
    }
  }

  // ── 4. Preenche uma vez; recargas de template retomam do armazenamento ───
  function iniciarGlpi() {
    if (aguardarLancamento()) return;
    receberDaUrl();
    const enviando = GM_getValue('vxGlpiEnviando', null);
    const numero = new URL(location.href).searchParams.get('id');
    const idadeEnvio = Date.now() - Number(enviando?.em);
    // O chamado criado vem do aviso "Item adicionado com sucesso: <link>", que o
    // GLPI mostra tanto ao abrir o chamado quanto ao voltar para o formulário
    // em branco (o padrão, com "ir para o item criado" desligado). Abrir outro
    // chamado qualquer nesses 3 min não tem esse aviso e não conta.
    const criado = [...document.querySelectorAll('#messages_after_redirect a[href*="ticket.form.php?id="]')]
      .map((a) => new URL(a.getAttribute('href'), location.href).searchParams.get('id'))
      .find((id) => /^[1-9]\d*$/.test(id || ''));
    if (criado && enviando && idadeEnvio >= 0 && idadeEnvio < 3 * 60 * 1000) {
      if (enviando.visitId) {
        const lancados = GM_getValue('vxGlpiLancados', {});
        lancados[enviando.visitId] = Number(criado);
        GM_setValue('vxGlpiLancados', lancados);
      }
      // Não apaga uma segunda visita aberta enquanto o primeiro chamado era revisto.
      if (lerEstado('vxGlpiPendente')?.lancamento?.visitId === enviando.visitId) apagarEstado('vxGlpiPendente');
      if (enviando.rascunhoId) excluirRascunho(enviando.rascunhoId);
      GM_deleteValue('vxGlpiEnviando');
    }
    rascunhosNoGlpi();
    sincronizarGlpi();
    window.addEventListener('focus', () => sincronizarGlpi());
    setInterval(() => sincronizarGlpi(), INTERVALO_SYNC);
    if (location.pathname !== '/front/ticket.form.php' || (numero && numero !== '0')) { ocultarCarregamento(); return; }
    let preenchendo = false;
    let temporizador;
    let visitIdAtual;
    cancelarAutossalvar = () => { clearTimeout(temporizador); temporizador = null; };
    const prontos = new WeakSet();
    const vinculados = new WeakSet();
    const editores = new WeakSet();

    function indicador(form) {
      let linha = form.querySelector('#vx-glpi-rascunho-salvo');
      const rascunho = rascunhos()[sessionStorage.getItem(CHAVE_ATUAL)];
      if (!rascunho?.campos) { linha?.remove(); return; }
      if (!linha) {
        linha = document.createElement('div'); linha.id = 'vx-glpi-rascunho-salvo';
        // Sem a classe "small": o GLPI tem "#page .small { width: 1% }", que
        // espremia a linha até uma letra por vez.
        linha.className = 'col-12 text-muted mb-2 d-flex flex-wrap align-items-center gap-2';
        linha.style.cssText = 'flex:0 0 100%;width:100%;max-width:100%;font-size:.875em';
        linha.innerHTML = '<span role="status"></span> <button type="button" class="btn btn-sm btn-link">Descartar rascunho</button>';
        linha.querySelector('button').onclick = () => {
          cancelarAutossalvar();
          excluirRascunho(sessionStorage.getItem(CHAVE_ATUAL));
          linha.remove();
        };
        const titulo = form.querySelector('[name="name"]');
        (titulo?.closest('.form-field') || titulo)?.before(linha);
      }
      linha.querySelector('span').textContent = 'Rascunho salvo às ' + new Date(rascunho.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function salvar(form) {
      if (preenchendo) return;
      try {
        const campos = capturarCampos(form);
        const textoHtml = document.createElement('div'); textoHtml.innerHTML = campos.content;
        const dados = rascunhos();
        const atual = dados[sessionStorage.getItem(CHAVE_ATUAL)];
        // Formulário sem título e sem descrição nunca é gravado: nem cria
        // rascunho nem apaga o conteúdo de um rascunho ligado a esta aba.
        if (!texto(campos.name) && !texto(textoHtml.textContent)) return;
        const rascunho = atual || novoRascunho({ origem: 'glpi' });
        rascunho.campos = campos; rascunho.atualizadoEm = Date.now();
        sessionStorage.setItem(CHAVE_ATUAL, rascunho.id);
        guardarRascunhos({ ...dados, [rascunho.id]: rascunho });
        indicador(form);
      } catch (erro) { registrar('salvar rascunho', erro); }
    }

    function agendar(form) {
      if (preenchendo) return;
      cancelarAutossalvar();
      temporizador = setTimeout(() => { temporizador = null; salvar(form); }, 1000);
    }

    function vincular(form) {
      if (!vinculados.has(form)) {
        vinculados.add(form);
        form.addEventListener('input', () => agendar(form));
        form.addEventListener('change', () => agendar(form));
        // Só o submitter add representa o envio manual, nunca a troca de template.
        form.addEventListener('submit', (e) => {
          cancelarAutossalvar();
          salvar(form);
          if (e.submitter?.name !== 'add') return;
          const rascunhoId = sessionStorage.getItem(CHAVE_ATUAL);
          const rascunho = rascunhos()[rascunhoId];
          GM_setValue('vxGlpiEnviando', { visitId: rascunho?.visitId || visitIdAtual, rascunhoId, em: Date.now() });
        }, true);
        // O POST nativo de template não dispara submit; guarda a última edição ao sair.
        window.addEventListener('pagehide', () => {
          if (!temporizador) return;
          cancelarAutossalvar(); salvar(form);
        });
        indicador(form);
      }
      // change do jQuery/select2 não chega ao addEventListener nativo.
      if (pagina.jQuery?.fn?.select2) pagina.jQuery(form).off('change.vxRascunho').on('change.vxRascunho', () => agendar(form));
      const el = form.querySelector('[name="content"]');
      const editor = el && pagina.tinymce?.get(el.id);
      if (editor?.initialized && !editores.has(editor)) {
        editores.add(editor);
        editor.on('input change', () => agendar(form));
      }
    }

    async function preencher() {
      const form = document.querySelector('form#itil-form.new-itil-object');
      if (!form) return;
      vincular(form);
      const pendente = lerEstado('vxGlpiPendente');
      const retomar = lerEstado('vxGlpiRetomar');
      const idadeRetomada = Date.now() - Number(retomar?.em);
      const restaurar = idadeRetomada >= 0 && idadeRetomada < VALIDADE && rascunhos()[retomar?.rascunhoId]?.campos;
      const idade = Date.now() - Number(pendente?.criadoEm);
      const carregarVisita = pendente?.lancamento && !pendente.preenchido && idade >= 0 && idade < VALIDADE;
      if ((!restaurar && !carregarVisita) || preenchendo || prontos.has(form)) return;
      const lancamento = pendente?.lancamento;
      preenchendo = true;
      mostrarCarregamento(restaurar ? 'Restaurando seu rascunho…' : 'Preenchendo os dados da visita…');
      cancelarAutossalvar();
      const rascunhoId = restaurar ? retomar.rascunhoId : pendente.rascunhoId;
      if (rascunhoId) sessionStorage.setItem(CHAVE_ATUAL, rascunhoId);
      visitIdAtual = restaurar ? rascunhos()[rascunhoId].visitId : lancamento.visitId;
      let aguardandoRecarga = false;
      const avisos = [];
      if (lancamento?.tituloAbreviado) avisos.push('Motivo abreviado no título pelo limite de 255 caracteres; consulte o texto completo na ficha Vortex');
      const feitos = [];
      const etapa = async (nome, acao) => {
        try { return await acao(); }
        catch (erro) { registrar(nome, erro); avisos.push(nome + ': não preenchido'); return false; }
      };
      const campo = (nome) => {
        const el = form.querySelector(`[name="${nome}"]`);
        if (!el) throw new Error('Campo ausente: ' + nome);
        return el;
      };
      try {
        await etapa('jQuery / select2', () => esperar(() => pagina.jQuery?.fn?.select2));
        // Cada troca recarrega a página; se o valor não "pegar" (sem permissão na
        // entidade, categoria fora do template), desiste após 2 tentativas em vez
        // de recarregar para sempre.
        const recarregar = async (nome, id, rotulo) => etapa(nome, async () => {
          const el = campo(nome);
          await esperar(() => pagina.jQuery(el).data('select2'));
          if (String(el.value) === String(id)) return false;
          const chave = restaurar ? 'vxGlpiRetomar' : 'vxGlpiPendente';
          const atual = lerEstado(chave);
          const tentativas = atual?.tentativas || {};
          if ((tentativas[nome] || 0) >= 2) { avisos.push(rotulo + ': não foi possível selecionar'); return false; }
          tentativas[nome] = (tentativas[nome] || 0) + 1;
          gravarEstado(chave, { ...atual, tentativas });
          aguardandoRecarga = selecionar(el, id, rotulo);
          return aguardandoRecarga;
        });
        if (restaurar) {
          for (const nome of ['entities_id', 'type', 'itilcategories_id']) {
            const dado = restaurar[nome];
            if (await recarregar(nome, dado.value, dado.text)) return;
          }
          for (const nome of SELECTS_RASCUNHO.filter((n) => !['entities_id', 'type', 'itilcategories_id'].includes(n))) {
            await etapa(nome, async () => {
              const el = campo(nome);
              await esperar(() => pagina.jQuery(el).data('select2'));
              selecionar(el, restaurar[nome].value, restaurar[nome].text);
            });
          }
          campo('name').value = restaurar.name;
          await etapa('Conteúdo', () => definirConteudo(campo('content'), restaurar.content));
          await etapa('Data de abertura', () => definirData(campo('date'), restaurar.date));
          for (const tipo of TIPOS_ATOR) await etapa('Atores ' + tipo, () => aplicarAtores(form, tipo, restaurar.atores[tipo]));
          apagarEstado('vxGlpiRetomar');
          prontos.add(form);
          faixa(['Rascunho restaurado. Confira e clique em Adicionar', ...avisos].join(' · '));
          return;
        }
        // Esses campos têm handlers nativos que POSTam sem "add", só para trocar template.
        if (await recarregar('entities_id', ENTIDADE, NOME_ENTIDADE)) return;
        if (await recarregar('type', TIPO, 'Requisição')) return;
        let categoria = { id: CATEGORIA_PADRAO, text: NOME_CATEGORIA };
        await etapa('Categoria', async () => {
          for (const modulo of lancamento.modulos || []) {
            const resultados = await etapa('Busca da categoria ' + modulo, () => buscar(campo('itilcategories_id'), modulo));
            const encontrada = resultados && resultados.find((r) => categoriaCompativel(r, modulo));
            if (encontrada) { categoria = encontrada; break; }
          }
        });
        if (await recarregar('itilcategories_id', categoria.id, categoria.text)) return;
        feitos.push('Categoria: ' + categoria.text);
        await etapa('Título', () => {
          const el = campo('name');
          if (el.value !== lancamento.titulo) {
            el.value = lancamento.titulo;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        // O editor pode terminar de carregar depois dos demais campos.
        const conteudo = etapa('Conteúdo', () => definirConteudo(campo('content'), lancamento.descricaoHtml));
        await etapa('Localização', async () => {
          const el = campo('locations_id');
          const resultados = await buscar(el, lancamento.unidade);
          const encontrada = escolherLocalizacao(resultados, lancamento.unidade);
          if (!encontrada) {
            selecionar(el, 0, '-----');
            avisos.push('Localização ausente ou ambígua para ' + lancamento.unidade);
            return;
          }
          selecionar(el, encontrada.id, encontrada.text);
          feitos.push(lancamento.unidade + ' → ' + encontrada.text);
        });
        await etapa('Data de abertura', () => {
          if (!lancamento.dataAbertura) throw new Error('Visita sem data/hora de início');
          const el = campo('date');
          definirData(el, lancamento.dataAbertura);
          feitos.push(`Abertura: ${lancamento.data} ${lancamento.horaInicio}`);
        });
        await etapa('Duração total', () => {
          const el = campo('actiontime');
          const opcao = opcaoDuracao([...el.options], lancamento.duracaoSegundos);
          if (!opcao) throw new Error('Visita sem duração');
          selecionar(el, opcao.valor, opcao.texto);
          feitos.push('Duração total: ' + opcao.texto);
          if (Math.abs(opcao.valor - lancamento.duracaoSegundos) > 300) avisos.push('Duração da visita fora da lista do GLPI; usado ' + opcao.texto);
        });
        await etapa('Atores', () => preencherAtores(form));
        await etapa('Status', () => selecionar(campo('status'), STATUS, 'Solucionado'));
        await conteudo;
        gravarEstado('vxGlpiPendente', { ...(lerEstado('vxGlpiPendente') || pendente), preenchido: true });
        prontos.add(form);
        faixa(['Visita carregada.', ...feitos, ...avisos, 'Confira e clique em Adicionar'].join(' · '));
      } catch (erro) {
        registrar('preparar formulário', erro);
        prontos.add(form);
        faixa('Não foi possível preparar o formulário. Confira os campos e clique em Adicionar');
      } finally {
        preenchendo = false;
        // Algumas instalações atualizam o template sem navegar.
        if (aguardandoRecarga) {
          // Mantém o autossalvar suspenso até a próxima tentativa/template.
          preenchendo = true;
          setTimeout(() => { preenchendo = false; preencher(); }, 500);
        } else if (prontos.has(form)) { ocultarCarregamento(); vincular(form); agendar(form); }
      }
    }
    observar(preencher);
  }

  guardarRascunhos(rascunhos());
  if (location.hostname === 'vortexom30.replit.app') iniciarVortex();
  if (location.hostname === 'suporte.om30.cloud') iniciarGlpi();
})();
