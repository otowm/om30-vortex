// ==UserScript==
// @name         Vortex — rascunho persistente e offline
// @namespace    otowm.vortex
// @version      1.4.1
// @homepageURL  https://github.com/otowm/om30-vortex
// @updateURL    https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-rascunho-offline.user.js
// @downloadURL  https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-rascunho-offline.user.js
// @description  Guarda o rascunho da Nova Visita fora da aba (sobrevive a fechar o app/aba), permite reiniciar ou escolher o horário de início ou descartar o rascunho, registra o service worker que o app deixa de registrar (para abrir sem internet) troca o /login pelo /acesso/<cliente> e abre o "Novo Agendamento" em modal.
// @match        https://vortexom30.replit.app/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSAO = '1.4.1';

  // ── 0. /login → /acesso/<cliente> ────────────────────────────────────────
  // Usuários de cliente não conseguem entrar pelo /login (só o admin da
  // plataforma), mas o app instalado abre em "/" e manda para /login quando a
  // sessão cai, ao sair e ao abrir sem sessão. /login?master mantém o login
  // de administrador acessível.
  const CLIENTE_PADRAO = 'guaruja';
  const ULTIMO_CLIENTE = 'vxUltimoCliente_v1';

  function slugCliente() {
    try {
      const salvo = localStorage.getItem(ULTIMO_CLIENTE);
      if (salvo) return salvo;
      const sessao = JSON.parse(localStorage.getItem('vt_offline_session') || 'null');
      if (sessao?.session?.clienteSlug) return sessao.session.clienteSlug;
    } catch { /* usa o padrão */ }
    return CLIENTE_PADRAO;
  }

  function lembrarCliente() {
    const m = location.pathname.match(/^\/acesso\/([a-z0-9-]+)\/?$/);
    if (m) try { localStorage.setItem(ULTIMO_CLIENTE, m[1]); } catch { /* nada a fazer */ }
  }

  function ehLoginBloqueado(url) {
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname.replace(/\/$/, '') === '/login' && !u.searchParams.has('master');
  }

  function irParaAcesso() {
    location.replace('/acesso/' + encodeURIComponent(slugCliente()));
  }

  if (ehLoginBloqueado(location.href)) { irParaAcesso(); return; }
  lembrarCliente();

  for (const metodo of ['pushState', 'replaceState']) {
    const original = history[metodo];
    history[metodo] = function (estado, titulo, url) {
      if (url != null && ehLoginBloqueado(String(url))) { irParaAcesso(); return; }
      const r = original.apply(this, arguments);
      lembrarCliente();
      return r;
    };
  }
  window.addEventListener('popstate', () => { if (ehLoginBloqueado(location.href)) irParaAcesso(); });

  // ── 1. Rascunho da Nova Visita ────────────────────────────────────────────
  // O app salva o rascunho (com a hora de início) só no sessionStorage, que
  // some ao fechar a aba/o app. Espelhamos a mesma chave no localStorage e
  // devolvemos ao sessionStorage antes do app ler. As regras do próprio app
  // continuam valendo: rascunho de outro usuário ou de outro dia é descartado
  // por ele, e ao finalizar a visita ele apaga o rascunho (apagamos a cópia junto).
  const CHAVE = 'novaVisitaDraft_v1';
  const COPIA = 'vxRascunhoPersistente_v1';

  const ss = window.sessionStorage;
  const ls = window.localStorage;
  const proto = Storage.prototype;
  const setItem = proto.setItem;
  const getItem = proto.getItem;
  const removeItem = proto.removeItem;

  function salvoEm(json) {
    try { return Date.parse(JSON.parse(json).salvoEm) || 0; } catch { return 0; }
  }

  let avisouFotos = false;
  function copiar(json) {
    try { setItem.call(ls, COPIA, json); return; } catch { /* sem espaço: tenta sem fotos */ }
    try {
      const d = JSON.parse(json);
      setItem.call(ls, COPIA, JSON.stringify({ ...d, photos: [], templatePhotos: [] }));
      if (!avisouFotos && (d.photos?.length || d.templatePhotos?.length)) {
        avisouFotos = true;
        aviso('As fotos deste rascunho são grandes demais para guardar fora da aba. Os textos estão guardados; se fechar o app, refaça as fotos.');
      }
    } catch (e) { console.warn('[vortex-us] não foi possível guardar o rascunho:', e); }
  }

  try {
    const local = getItem.call(ls, COPIA);
    const sessao = getItem.call(ss, CHAVE);
    if (local && (!sessao || salvoEm(local) > salvoEm(sessao))) setItem.call(ss, CHAVE, local);
  } catch (e) { console.warn('[vortex-us] não foi possível restaurar o rascunho:', e); }

  // Ligado entre ajustar o rascunho e recarregar: impede o app de regravar
  // o rascunho antigo que ainda está na memória dele.
  let congelado = false;

  proto.setItem = function (k, v) {
    if (congelado && this === ss && k === CHAVE) return;
    const r = setItem.apply(this, arguments);
    if (this === ss && k === CHAVE) copiar(String(v));
    return r;
  };
  proto.removeItem = function (k) {
    const r = removeItem.apply(this, arguments);
    if (this === ss && k === CHAVE) {
      try { removeItem.call(ls, COPIA); } catch { /* nada a fazer */ }
    }
    return r;
  };

  // ── 2. Offline ────────────────────────────────────────────────────────────
  // O app só registra /sw.js num listener de "load" que ele adiciona depois de
  // ler o IndexedDB; quando a leitura termina após o load (o normal), o
  // service worker nunca é registrado e o app instalado não abre sem internet.
  // Registrar uma vez já vale para o app instalado também (mesma origem).
  async function garantirOffline() {
    if (!('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    try {
      if (!(await sw.getRegistration('/'))) await sw.register('/sw.js');
      const reg = await sw.ready;
      reg.active?.postMessage({ type: 'outbox-status' });
      if (!sw.controller) {
        await new Promise((ok) => {
          sw.addEventListener('controllerchange', ok, { once: true });
          setTimeout(ok, 10000);
        });
      }
      if (sw.controller) await aquecerCache();
    } catch (e) { console.warn('[vortex-us] service worker:', e); }
  }

  // O JS/CSS desta página foi baixado antes do service worker assumir, então
  // não está no cache dele. Buscar de novo pelo SW guarda (só o que falta).
  async function aquecerCache() {
    const urls = [
      ...[...document.querySelectorAll('script[src]')].map((s) => s.src),
      ...[...document.querySelectorAll('link[rel=stylesheet][href], link[rel=modulepreload][href]')].map((l) => l.href),
      ...[...document.querySelectorAll('img[src]')].map((i) => i.src),
    ].filter((u) => u.startsWith(location.origin + '/'));
    for (const u of new Set(urls)) {
      try { if (!(await caches.match(u))) await fetch(u, { credentials: 'same-origin' }); } catch { /* offline agora */ }
    }
  }

  function aviso(texto) {
    const mostrar = () => {
      const el = document.createElement('div');
      el.textContent = texto;
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:10px 14px;border-radius:8px;background:#7c2d12;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer';
      el.title = 'Toque para fechar';
      el.onclick = () => el.remove();
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 12000);
    };
    document.body ? mostrar() : document.addEventListener('DOMContentLoaded', mostrar, { once: true });
  }

  // ── 3. Aviso "mod ativo" no popover da nuvenzinha ─────────────────────────
  // Mostra que o script rodou e onde (app instalado ou aba), e o estado do
  // rascunho guardado e do offline. Usa classes que o próprio app já tem.
  const ICONE_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400"><path d="M21.801 10A10 10 0 1 1 17 3.335"></path><path d="m9 11 3 3L22 4"></path></svg>';

  function textoRascunho() {
    const d = lerRascunho();
    return d ? `Rascunho guardado (início ${d.horaInicio || '?'})` : 'Nenhum rascunho guardado';
  }

  async function textoOffline() {
    if (!('serviceWorker' in navigator)) return 'Offline indisponível neste navegador';
    if (!navigator.serviceWorker.controller) return 'Offline: preparando (abra uma vez com internet)';
    const script = document.querySelector('script[src*="/assets/"]');
    const pronto = script && (await caches.match(script.src).catch(() => null));
    return pronto ? 'Offline pronto' : 'Offline: baixando o app…';
  }

  function montarAviso(popover) {
    popover.setAttribute('data-vx', '');
    const alvo = popover.querySelector('.space-y-3') || popover;
    const instalado = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    const caixa = document.createElement('div');
    caixa.className = 'rounded-md border bg-muted/40 p-2';
    caixa.setAttribute('data-testid', 'vx-mod-ativo');
    caixa.innerHTML = `<div class="flex items-start gap-2">${ICONE_OK}<div class="flex-1">` +
      `<p class="text-xs font-medium">Mod ativo · v${VERSAO}</p>` +
      `<p class="text-xs text-muted-foreground">Rodando no ${instalado ? 'app instalado' : 'navegador (aba)'}.</p>` +
      `<p class="text-xs text-muted-foreground" data-vx="rascunho"></p>` +
      `<p class="text-xs text-muted-foreground" data-vx="offline"></p></div></div>`;
    const linhaRascunho = caixa.querySelector('[data-vx="rascunho"]');
    linhaRascunho.textContent = textoRascunho();
    if (lerRascunho()) {
      const ajustar = document.createElement('button');
      ajustar.type = 'button';
      ajustar.className = 'block text-xs font-medium text-primary hover:underline';
      ajustar.textContent = 'Reiniciar horário ou descartar';
      ajustar.addEventListener('click', abrirAjuste);
      linhaRascunho.after(ajustar);
    }
    const linhaOffline = caixa.querySelector('[data-vx="offline"]');
    linhaOffline.textContent = 'Offline: verificando…';
    textoOffline().then((t) => { linhaOffline.textContent = t; });
    alvo.appendChild(caixa);
  }

  // ── 4. Reiniciar o horário de início / descartar o rascunho ───────────────
  // O app congela o início no primeiro toque em qualquer campo e não oferece
  // como desfazer. "Ajustar" no quadro Início (e na nuvenzinha) abre um
  // diálogo que reescreve o rascunho guardado e recarrega a Nova Visita.
  function lerRascunho() {
    try { return JSON.parse(getItem.call(ss, CHAVE) || getItem.call(ls, COPIA) || 'null'); } catch { return null; }
  }

  const doisDigitos = (n) => String(n).padStart(2, '0');
  const horaDe = (data) => `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;

  function aplicarNaTela() {
    if (!location.pathname.startsWith('/nova-visita')) return;
    congelado = true;
    // O app pede confirmação para sair com rascunho aberto; aqui a saída é intencional.
    window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);
    location.reload();
  }

  // Sem argumento, usa a hora atual; com uma data, usa esse horário de início.
  function reiniciarHorario(inicio) {
    const d = lerRascunho();
    if (!d) return;
    const agora = new Date();
    const alvo = inicio || agora;
    Object.assign(d, {
      inicioMs: alvo.getTime(),
      dataAtualIso: alvo.toISOString(),
      horaInicio: horaDe(alvo),
      salvoEm: agora.toISOString(),
    });
    const json = JSON.stringify(d);
    try { setItem.call(ss, CHAVE, json); } catch { /* sessão cheia: a cópia mais nova vence ao recarregar */ }
    copiar(json);
    aplicarNaTela();
  }

  function descartarRascunho() {
    try { removeItem.call(ss, CHAVE); } catch { /* nada a fazer */ }
    try { removeItem.call(ls, COPIA); } catch { /* nada a fazer */ }
    aplicarNaTela();
  }

  const CLASSE_BOTAO = 'inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-3 w-full ';

  function abrirAjuste() {
    document.querySelector('[data-testid="vx-ajuste"]')?.remove();
    const d = lerRascunho();
    const fundo = document.createElement('div');
    fundo.setAttribute('data-testid', 'vx-ajuste');
    fundo.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.6)';
    fundo.innerHTML = '<div class="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg text-foreground space-y-3" role="dialog" aria-modal="true">' +
      '<p class="text-base font-semibold">Horário de início</p>' +
      '<p class="text-sm text-muted-foreground" data-vx="texto"></p>' +
      '<div class="flex flex-col gap-2" data-vx="botoes"></div></div>';
    const texto = fundo.querySelector('[data-vx="texto"]');
    const botoes = fundo.querySelector('[data-vx="botoes"]');

    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', comEsc, true); };
    const comEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    const botao = (rotulo, variante, acao) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = CLASSE_BOTAO + variante;
      b.textContent = rotulo;
      b.addEventListener('click', acao);
      botoes.appendChild(b);
      return b;
    };

    if (d) {
      const dia = d.dataAtualIso ? ` de ${new Date(d.dataAtualIso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : '';
      texto.textContent = `Início atual: ${d.horaInicio || '?'}${dia}. "Começar agora" ou "Usar este horário" mantêm o que já foi preenchido e trocam só o horário de hoje. "Descartar" apaga o rascunho inteiro.`;
      botao(`Começar agora (${horaDe(new Date())})`, 'bg-primary text-primary-foreground', () => { fechar(); reiniciarHorario(); });

      // Horário escolhido manualmente (sempre no dia de hoje, nunca no futuro).
      const linha = document.createElement('div');
      linha.className = 'flex gap-2';
      const campoHora = document.createElement('input');
      campoHora.type = 'time';
      campoHora.required = true;
      campoHora.setAttribute('aria-label', 'Novo horário de início');
      campoHora.className = 'h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm';
      campoHora.value = d.horaInicio && /^\d{2}:\d{2}$/.test(d.horaInicio) ? d.horaInicio : horaDe(new Date());
      const usar = document.createElement('button');
      usar.type = 'button';
      usar.className = 'inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-3 border border-input hover:bg-accent';
      usar.textContent = 'Usar este horário';
      const erro = document.createElement('p');
      erro.className = 'text-xs text-destructive';
      erro.hidden = true;
      usar.addEventListener('click', () => {
        const m = /^(\d{2}):(\d{2})$/.exec(campoHora.value);
        const agora = new Date();
        const alvo = m ? new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), +m[1], +m[2]) : null;
        if (!alvo) { erro.textContent = 'Informe um horário válido.'; erro.hidden = false; return; }
        if (alvo.getTime() > agora.getTime()) { erro.textContent = 'O início não pode ser depois de agora.'; erro.hidden = false; return; }
        fechar();
        reiniciarHorario(alvo);
      });
      campoHora.addEventListener('keydown', (e) => { if (e.key === 'Enter') usar.click(); });
      linha.append(campoHora, usar);
      botoes.append(linha, erro);

      const descartar = botao('Descartar rascunho', 'border border-destructive/50 text-destructive', () => {
        if (descartar.dataset.confirmar) { fechar(); descartarRascunho(); return; }
        descartar.dataset.confirmar = '1';
        descartar.textContent = 'Toque de novo para apagar tudo';
      });
      botao('Cancelar', 'hover:bg-accent', fechar);
    } else {
      texto.textContent = 'Nenhum rascunho aberto. O início acompanha a hora atual e só trava no primeiro toque em algum campo da Nova Visita.';
      botao('Fechar', 'bg-primary text-primary-foreground', fechar);
    }

    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    document.addEventListener('keydown', comEsc, true);
    document.body.appendChild(fundo);
  }

  function montarBotaoInicio() {
    if (!location.pathname.startsWith('/nova-visita')) return;
    for (const rotulo of document.querySelectorAll('p.uppercase')) {
      const t = rotulo.textContent.trim();
      if (t !== 'Início' && t !== 'Start') continue;
      const quadro = rotulo.parentElement;
      if (!quadro || quadro.querySelector('[data-vx="ajustar"]')) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-vx', 'ajustar');
      b.className = 'block text-[10px] font-medium text-primary hover:underline leading-tight mt-0.5';
      b.textContent = 'Ajustar';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); abrirAjuste(); });
      quadro.appendChild(b);
    }
  }

  // ── 5. "Novo Agendamento" em modal ────────────────────────────────────────
  // Em /agendar, o botão "Novo Agendamento" abre o formulário no fim da página.
  // Sem mover o nó (o React continua dono dele), o bloco que aparece com campos
  // de formulário é posicionado como um modal sobre um fundo escuro.
  const ESTILO_MODAL = `
    [data-vx-modal="1"] {
      position: fixed !important; z-index: 2147483645 !important;
      top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important;
      width: min(640px, calc(100vw - 32px)) !important; max-height: calc(100vh - 32px) !important;
      overflow: auto !important; margin: 0 !important;
      background: hsl(var(--background, 0 0% 100%)) !important; color: hsl(var(--foreground, 0 0% 0%));
      border-radius: 12px !important; box-shadow: 0 20px 50px rgba(0,0,0,.35) !important; padding: 16px !important;
    }
    [data-vx-modal-fundo] { position: fixed; inset: 0; z-index: 2147483644; background: rgba(0,0,0,.6); }
    body[data-vx-modal-aberto] { overflow: hidden !important; }`;

  let modal = null; // { no, fundo, botao, vigia }

  function fecharModal(clicarBotao) {
    if (!modal) return;
    const { no, fundo, botao, vigia } = modal;
    modal = null;
    clearInterval(vigia);
    fundo.remove();
    no.removeAttribute('data-vx-modal');
    document.body.removeAttribute('data-vx-modal-aberto');
    document.removeEventListener('keydown', escModal, true);
    // Fechar pelo fundo ou Esc: por enquanto recarrega a página, porque reabrir
    // o formulário depois de fechá-lo por aqui não funcionava.
    if (clicarBotao) location.reload();
  }
  function escModal(e) { if (e.key === 'Escape' && modal) { e.stopPropagation(); fecharModal(true); } }

  function abrirModal(no, botao) {
    fecharModal(false);
    if (!document.getElementById('vx-modal-estilo')) {
      const st = document.createElement('style');
      st.id = 'vx-modal-estilo';
      st.textContent = ESTILO_MODAL;
      document.head.appendChild(st);
    }
    const fundo = document.createElement('div');
    fundo.setAttribute('data-vx-modal-fundo', '');
    fundo.addEventListener('click', () => fecharModal(true));
    document.body.appendChild(fundo);
    no.setAttribute('data-vx-modal', '1');
    document.body.setAttribute('data-vx-modal-aberto', '');
    document.addEventListener('keydown', escModal, true);
    // Formulário salvo/cancelado pelo app: o bloco some e o fundo sai junto.
    const vigia = setInterval(() => {
      if (!modal) return;
      if (!no.isConnected || getComputedStyle(no).display === 'none') fecharModal(false);
    }, 300);
    modal = { no, fundo, botao, vigia };
    no.querySelector('input:not([type=hidden]), select, textarea, button[role=combobox]')?.focus?.({ preventScroll: true });
  }

  const temCampos = (el) => el.nodeType === 1 && (el.matches('form, input, select, textarea') || el.querySelector('form, input:not([type=hidden]), select, textarea, [role=combobox]'));

  // Sobe a partir do nó novo enquanto o pai não for um contêiner que já existia
  // com outros conteúdos (ex.: a lista de agendamentos).
  function blocoDe(el, antes) {
    let atual = el;
    while (atual.parentElement && atual.parentElement !== document.body && !antes.has(atual.parentElement) && atual.parentElement.tagName !== 'MAIN') {
      atual = atual.parentElement;
    }
    return atual;
  }

  document.addEventListener('click', (e) => {
    if (!location.pathname.startsWith('/agendar')) return;
    const botao = e.target.closest?.('button, a, [role=button]');
    if (!botao || modal) return;
    if (!/novo agendamento/i.test(botao.textContent || '')) return;
    const antes = new Set(document.querySelectorAll('body *'));
    let achou = false;
    const obs = new MutationObserver((mudancas) => {
      for (const m of mudancas) {
        for (const n of m.addedNodes) {
          if (achou || n.nodeType !== 1 || !temCampos(n)) continue;
          achou = true;
          obs.disconnect();
          setTimeout(() => abrirModal(blocoDe(n, antes), botao), 0);
          return;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 3000);
  }, true);

  let agendado = false;
  new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    setTimeout(() => {
      agendado = false;
      const popover = document.querySelector('[data-testid="popover-offline-status"]:not([data-vx])');
      if (popover) montarAviso(popover);
      montarBotaoInicio();
    }, 50);
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'complete') garantirOffline();
  else window.addEventListener('load', () => setTimeout(garantirOffline, 500), { once: true });
})();
