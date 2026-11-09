(() => {
  const STORAGE_KEY = 'vendas_restaurante_v1';
  const FIRESTORE_COLLECTION = 'vendas_diarias';

  // Configuração do seu projeto Firebase já existente (daily-shops-restaurant)
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDyASg7Uco8QXz2xX1iSQLpvHemHUhkJDU',
    authDomain: 'daily-shops-restaurant.firebaseapp.com',
    projectId: 'daily-shops-restaurant',
    storageBucket: 'daily-shops-restaurant.firebasestorage.app',
    messagingSenderId: '543308589335',
    appId: '1:543308589335:web:3114393ee5bb396986af52',
    measurementId: 'G-1W0PTXL8GT'
  };

  const MESES_NOMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  // Estado da aplicação
  let vendas = [];
  let anoSelecionadoMensal = new Date().getFullYear();
  let dbFirestore = null;
  let cloudAtiva = false;

  // Utilitários numéricos e de data
  function round2(num) {
    return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
  }

  function parseMoeda(valorStr) {
    if (typeof valorStr === 'number') return round2(valorStr);
    if (!valorStr) return 0;
    let limpo = String(valorStr).trim().replace(/[^\d.,-]/g, '');
    if (!limpo) return 0;

    if (limpo.includes('.') && limpo.includes(',')) {
      limpo = limpo.replace(/\./g, '').replace(',', '.');
    } else if (limpo.includes(',')) {
      limpo = limpo.replace(',', '.');
    }

    const parsed = parseFloat(limpo);
    return Number.isFinite(parsed) && parsed >= 0 ? round2(parsed) : 0;
  }

  function formatarMoeda(valor) {
    return currencyFormatter.format(round2(valor || 0));
  }

  function formatarNumeroInput(valor) {
    const num = round2(valor || 0);
    if (num === 0) return '';
    return num.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function hojeISO() {
    const d = new Date();
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  function mesAtualISO() {
    return hojeISO().slice(0, 7);
  }

  function formatarDataBR(isoDate) {
    if (!isoDate || !isoDate.includes('-')) return isoDate || '';
    const [ano, mes, dia] = isoDate.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function obterDiaSemanaCurto(isoDate) {
    if (!isoDate) return '';
    const [ano, mes, dia] = isoDate.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return dias[d.getDay()] || '';
  }

  function calcularTotaisRegistro(item) {
    const cartao = round2(item.cartao || 0);
    const mesa = round2(item.mesa || 0);
    const ifood = round2(item.ifood || 0);
    const dinheiro = round2(item.dinheiro || 0);
    const saida = round2(item.saida || 0);
    const totalBruto = round2(cartao + mesa + ifood + dinheiro);
    const totalLiquido = round2(totalBruto - saida);
    return { cartao, mesa, ifood, dinheiro, saida, totalBruto, totalLiquido };
  }

  function normalizarRegistro(item) {
    const totais = calcularTotaisRegistro(item);
    return {
      id: String(item.id || `${item.data}-${Date.now()}`),
      data: String(item.data).slice(0, 10),
      ...totais,
      observacao: item.observacao ? String(item.observacao).trim() : '',
      atualizadoEm: item.atualizadoEm || new Date().toISOString()
    };
  }

  function atualizarBadgeNuvem(status, texto) {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;
    badge.className = `sync-badge sync-${status}`;
    badge.textContent = texto;
  }

  // Persistência LocalStorage (Cache rápido e backup local)
  function carregarDadosLocais() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        vendas = [];
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        vendas = parsed
          .filter((item) => item && typeof item.data === 'string')
          .map(normalizarRegistro);
        ordenarVendas();
      }
    } catch (err) {
      console.error('Erro ao ler dados do LocalStorage:', err);
      vendas = [];
    }
  }

  function salvarDadosLocais() {
    ordenarVendas();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vendas));
  }

  function ordenarVendas() {
    vendas.sort((a, b) => b.data.localeCompare(a.data));
  }

  // Integração Firebase Cloud Firestore em Tempo Real
  function iniciarSincronizacaoNuvem() {
    if (typeof window.firebase === 'undefined') {
      atualizarBadgeNuvem('offline', '🟡 Modo Local (Offline)');
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      dbFirestore = firebase.firestore();

      // Habilita cache offline do Firestore para múltiplos dispositivos
      dbFirestore.enablePersistence({ synchronizeTabs: true }).catch(() => {});

      // Escuta em tempo real qualquer mudança feita em qualquer celular/PC
      dbFirestore.collection(FIRESTORE_COLLECTION).onSnapshot(
        async (snapshot) => {
          cloudAtiva = true;
          atualizarBadgeNuvem('online', '🟢 Nuvem Sincronizada');

          const registrosNuvem = [];
          const idsNuvem = new Set();

          snapshot.forEach((doc) => {
            const dataDoc = doc.data();
            if (dataDoc && typeof dataDoc.data === 'string') {
              const reg = normalizarRegistro({ ...dataDoc, id: doc.id });
              registrosNuvem.push(reg);
              idsNuvem.add(reg.id);
            }
          });

          // Se havia registros salvos localmente antes de conectar na nuvem, sobe para o banco
          const locaisNaoSincronizados = vendas.filter((localItem) => !idsNuvem.has(localItem.id));
          if (locaisNaoSincronizados.length > 0 && snapshot.metadata.fromCache === false) {
            for (const itemLocal of locaisNaoSincronizados) {
              try {
                await dbFirestore.collection(FIRESTORE_COLLECTION).doc(itemLocal.id).set(itemLocal);
                registrosNuvem.push(itemLocal);
              } catch (e) {
                console.warn('Falha ao subir item local para nuvem:', e);
              }
            }
          }

          vendas = registrosNuvem;
          salvarDadosLocais();
          renderizarTudo();
        },
        (error) => {
          console.warn('Aviso Firestore (usando armazenamento local):', error);
          cloudAtiva = false;
          atualizarBadgeNuvem('offline', '🟡 Modo Local (Verifique Regras Firestore)');
        }
      );
    } catch (err) {
      console.warn('Erro ao inicializar Firebase:', err);
      atualizarBadgeNuvem('offline', '🟡 Modo Local');
    }
  }

  async function salvarRegistroNoBanco(registro) {
    const regNormalizado = normalizarRegistro({
      ...registro,
      atualizadoEm: new Date().toISOString()
    });

    const idx = vendas.findIndex((v) => v.id === regNormalizado.id);
    if (idx !== -1) {
      vendas[idx] = regNormalizado;
    } else {
      vendas.push(regNormalizado);
    }
    salvarDadosLocais();
    renderizarTudo();

    if (dbFirestore) {
      try {
        await dbFirestore
          .collection(FIRESTORE_COLLECTION)
          .doc(regNormalizado.id)
          .set(regNormalizado);
      } catch (err) {
        console.error('Erro ao salvar na nuvem:', err);
        mostrarToast('Salvo no aparelho (sincronizará quando conectar).', 'error');
      }
    }
  }

  async function removerRegistroDoBanco(id) {
    vendas = vendas.filter((v) => v.id !== id);
    salvarDadosLocais();
    renderizarTudo();

    if (dbFirestore) {
      try {
        await dbFirestore.collection(FIRESTORE_COLLECTION).doc(id).delete();
      } catch (err) {
        console.error('Erro ao excluir na nuvem:', err);
      }
    }
  }

  // Notificação Toast
  function mostrarToast(mensagem, tipo = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagem;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  // Elementos DOM principais
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const inputData = document.getElementById('inputData');
  const editingId = document.getElementById('editingId');
  const inputCartao = document.getElementById('inputCartao');
  const inputMesa = document.getElementById('inputMesa');
  const inputIfood = document.getElementById('inputIfood');
  const inputDinheiro = document.getElementById('inputDinheiro');
  const inputSaida = document.getElementById('inputSaida');
  const inputObservacao = document.getElementById('inputObservacao');

  const previewBruto = document.getElementById('previewBruto');
  const previewSaida = document.getElementById('previewSaida');
  const previewLiquido = document.getElementById('previewLiquido');

  const avisoDataExistente = document.getElementById('avisoDataExistente');
  const btnCarregarDataExistente = document.getElementById('btnCarregarDataExistente');
  const btnCancelarEdicao = document.getElementById('btnCancelarEdicao');
  const btnLimparCampos = document.getElementById('btnLimparCampos');
  const btnSalvarVenda = document.getElementById('btnSalvarVenda');
  const formVendaDiaria = document.getElementById('formVendaDiaria');

  // Navegação por Abas
  function ativarAba(tabId) {
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === tabId);
    });
    renderizarTudo();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => ativarAba(btn.dataset.tab));
  });

  document.getElementById('btnIrParaMesAtual').addEventListener('click', () => {
    anoSelecionadoMensal = new Date().getFullYear();
    ativarAba('tab-mensal');
  });

  document.getElementById('btnVerTodoHistorico').addEventListener('click', () => {
    ativarAba('tab-historico');
  });

  // Cálculo em tempo real no formulário principal
  function atualizarPreviewFormulario() {
    const cartao = parseMoeda(inputCartao.value);
    const mesa = parseMoeda(inputMesa.value);
    const ifood = parseMoeda(inputIfood.value);
    const dinheiro = parseMoeda(inputDinheiro.value);
    const saida = parseMoeda(inputSaida.value);

    const bruto = round2(cartao + mesa + ifood + dinheiro);
    const liquido = round2(bruto - saida);

    previewBruto.textContent = formatarMoeda(bruto);
    previewSaida.textContent = `- ${formatarMoeda(saida)}`;
    previewLiquido.textContent = formatarMoeda(liquido);
    previewLiquido.classList.toggle('negative', liquido < 0);
  }

  [inputCartao, inputMesa, inputIfood, inputDinheiro, inputSaida].forEach((input) => {
    input.addEventListener('input', atualizarPreviewFormulario);
  });

  // Verificar se a data escolhida já possui lançamento
  function verificarDataExistente() {
    const dataEscolhida = inputData.value;
    const idEmEdicao = editingId.value;
    const existente = vendas.find((v) => v.data === dataEscolhida && v.id !== idEmEdicao);

    if (existente) {
      avisoDataExistente.classList.remove('hidden');
      btnCarregarDataExistente.onclick = () => carregarParaEdicaoNoFormulario(existente);
    } else {
      avisoDataExistente.classList.add('hidden');
    }
  }

  inputData.addEventListener('change', verificarDataExistente);

  function carregarParaEdicaoNoFormulario(registro) {
    editingId.value = registro.id;
    inputData.value = registro.data;
    inputCartao.value = formatarNumeroInput(registro.cartao);
    inputMesa.value = formatarNumeroInput(registro.mesa);
    inputIfood.value = formatarNumeroInput(registro.ifood);
    inputDinheiro.value = formatarNumeroInput(registro.dinheiro);
    inputSaida.value = formatarNumeroInput(registro.saida);
    inputObservacao.value = registro.observacao || '';

    btnSalvarVenda.innerHTML = '💾 Atualizar Fechamento do Dia';
    btnCancelarEdicao.classList.remove('hidden');
    avisoDataExistente.classList.add('hidden');
    atualizarPreviewFormulario();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function limparFormulario(manterData = true) {
    editingId.value = '';
    if (!manterData || !inputData.value) {
      inputData.value = hojeISO();
    }
    inputCartao.value = '';
    inputMesa.value = '';
    inputIfood.value = '';
    inputDinheiro.value = '';
    inputSaida.value = '';
    inputObservacao.value = '';

    btnSalvarVenda.innerHTML = '✅ Salvar Fechamento do Dia';
    btnCancelarEdicao.classList.add('hidden');
    atualizarPreviewFormulario();
    verificarDataExistente();
  }

  btnLimparCampos.addEventListener('click', () => limparFormulario(true));
  btnCancelarEdicao.addEventListener('click', () => limparFormulario(false));

  // Salvar lançamento diário
  formVendaDiaria.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = inputData.value;
    if (!data) {
      mostrarToast('Selecione a data do fechamento.', 'error');
      inputData.focus();
      return;
    }

    const cartao = parseMoeda(inputCartao.value);
    const mesa = parseMoeda(inputMesa.value);
    const ifood = parseMoeda(inputIfood.value);
    const dinheiro = parseMoeda(inputDinheiro.value);
    const saida = parseMoeda(inputSaida.value);
    const observacao = inputObservacao.value.trim();

    if (cartao === 0 && mesa === 0 && ifood === 0 && dinheiro === 0 && saida === 0) {
      mostrarToast('Informe pelo menos um valor para salvar o dia.', 'error');
      inputCartao.focus();
      return;
    }

    const idAtual = editingId.value;
    const existenteMesmaData = vendas.find((v) => v.data === data && v.id !== idAtual);

    if (existenteMesmaData && !idAtual) {
      const desejaSomar = window.confirm(
        `Já existe um fechamento salvo no dia ${formatarDataBR(data)}.\n\n` +
        `Clique em "OK" para SOMAR estes valores ao fechamento daquele dia, ou em "Cancelar" se preferir editar manualmente.`
      );
      if (!desejaSomar) {
        carregarParaEdicaoNoFormulario(existenteMesmaData);
        return;
      }

      const novaObs = observacao
        ? (existenteMesmaData.observacao ? `${existenteMesmaData.observacao} | ${observacao}` : observacao)
        : existenteMesmaData.observacao;

      await salvarRegistroNoBanco({
        id: existenteMesmaData.id,
        data: existenteMesmaData.data,
        cartao: existenteMesmaData.cartao + cartao,
        mesa: existenteMesmaData.mesa + mesa,
        ifood: existenteMesmaData.ifood + ifood,
        dinheiro: existenteMesmaData.dinheiro + dinheiro,
        saida: existenteMesmaData.saida + saida,
        observacao: novaObs
      });

      limparFormulario(true);
      mostrarToast(`Valores somados ao dia ${formatarDataBR(data)}!`);
      return;
    }

    const novoOuEditadoId = idAtual || `venda-${data}`;
    await salvarRegistroNoBanco({
      id: novoOuEditadoId,
      data,
      cartao,
      mesa,
      ifood,
      dinheiro,
      saida,
      observacao
    });

    limparFormulario(false);
    mostrarToast(
      idAtual
        ? `Fechamento de ${formatarDataBR(data)} atualizado em todos os aparelhos!`
        : `Fechamento de ${formatarDataBR(data)} salvo e sincronizado!`
    );
  });

  // Renderização: Resumo Lateral do Mês Atual + Últimos Lançamentos
  function renderizarAbaLancamento() {
    const mesIso = mesAtualISO();
    const [anoAtual, mesAtualNum] = mesIso.split('-').map(Number);
    const nomeMesAtual = `${MESES_NOMES[mesAtualNum - 1]} / ${anoAtual}`;
    document.getElementById('labelMesAtualResumo').textContent = nomeMesAtual;

    const vendasMesAtual = vendas.filter((v) => v.data.startsWith(mesIso));
    const brutoMes = vendasMesAtual.reduce((acc, v) => acc + v.totalBruto, 0);
    const saidaMes = vendasMesAtual.reduce((acc, v) => acc + v.saida, 0);
    const liquidoMes = vendasMesAtual.reduce((acc, v) => acc + v.totalLiquido, 0);

    document.getElementById('resumoMesAtualBruto').textContent = formatarMoeda(brutoMes);
    document.getElementById('resumoMesAtualSaida').textContent = formatarMoeda(saidaMes);
    const elLiquidoMes = document.getElementById('resumoMesAtualLiquido');
    elLiquidoMes.textContent = formatarMoeda(liquidoMes);
    elLiquidoMes.classList.toggle('text-negative', liquidoMes < 0);

    const qtdDias = vendasMesAtual.length;
    document.getElementById('resumoMesAtualDias').textContent =
      qtdDias === 1 ? '1 dia lançado neste mês' : `${qtdDias} dias lançados neste mês`;

    // Últimos 7 lançamentos
    const containerRecentes = document.getElementById('listaUltimosLancamentos');
    containerRecentes.innerHTML = '';

    if (vendas.length === 0) {
      containerRecentes.innerHTML = `
        <p class="text-muted">Nenhum fechamento registrado ainda. Preencha os dados ao lado e clique em Salvar.</p>
      `;
      return;
    }

    vendas.slice(0, 7).forEach((item) => {
      const div = document.createElement('div');
      div.className = 'recent-item';
      div.title = 'Clique para editar ou ver detalhes';
      div.innerHTML = `
        <div>
          <div class="recent-date">${formatarDataBR(item.data)} <span class="text-muted small">(${obterDiaSemanaCurto(item.data)})</span></div>
          <div class="recent-breakdown">
            Cartão: ${formatarMoeda(item.cartao)} · Mesa: ${formatarMoeda(item.mesa)} · iFood: ${formatarMoeda(item.ifood)} · Din: ${formatarMoeda(item.dinheiro)}
          </div>
        </div>
        <div class="recent-values">
          <span class="recent-liquido ${item.totalLiquido < 0 ? 'text-negative' : ''}">${formatarMoeda(item.totalLiquido)}</span>
          <span class="recent-bruto">Bruto: ${formatarMoeda(item.totalBruto)}${item.saida > 0 ? ` | Saída: -${formatarMoeda(item.saida)}` : ''}</span>
        </div>
      `;
      div.addEventListener('click', () => abrirModalEdicao(item.id));
      containerRecentes.appendChild(div);
    });
  }

  // ABA 2: Faturamento Mês a Mês
  const selectAnoMensal = document.getElementById('selectAnoMensal');
  const chkApenasMesesComMovimento = document.getElementById('chkApenasMesesComMovimento');

  function atualizarOpcoesAno() {
    const anoCorrente = new Date().getFullYear();
    const anosSet = new Set([anoCorrente, anoCorrente - 1, anoSelecionadoMensal]);
    vendas.forEach((v) => {
      const a = parseInt(v.data.slice(0, 4), 10);
      if (Number.isFinite(a)) anosSet.add(a);
    });

    const anosOrdenados = Array.from(anosSet).sort((a, b) => b - a);
    selectAnoMensal.innerHTML = '';
    anosOrdenados.forEach((ano) => {
      const opt = document.createElement('option');
      opt.value = String(ano);
      opt.textContent = String(ano);
      if (ano === anoSelecionadoMensal) opt.selected = true;
      selectAnoMensal.appendChild(opt);
    });
  }

  selectAnoMensal.addEventListener('change', () => {
    anoSelecionadoMensal = parseInt(selectAnoMensal.value, 10);
    renderizarAbaMensal();
  });

  document.getElementById('btnAnoAnterior').addEventListener('click', () => {
    anoSelecionadoMensal -= 1;
    atualizarOpcoesAno();
    renderizarAbaMensal();
  });

  document.getElementById('btnAnoProximo').addEventListener('click', () => {
    anoSelecionadoMensal += 1;
    atualizarOpcoesAno();
    renderizarAbaMensal();
  });

  chkApenasMesesComMovimento.addEventListener('change', renderizarAbaMensal);

  function renderizarAbaMensal() {
    atualizarOpcoesAno();
    document.getElementById('labelAnoTabela').textContent = String(anoSelecionadoMensal);

    const prefixoAno = `${anoSelecionadoMensal}-`;
    const vendasDoAno = vendas.filter((v) => v.data.startsWith(prefixoAno));

    const dadosMeses = Array.from({ length: 12 }, (_, idx) => {
      const mesNumero = idx + 1;
      const mesIso = `${anoSelecionadoMensal}-${String(mesNumero).padStart(2, '0')}`;
      const registros = vendasDoAno.filter((v) => v.data.startsWith(mesIso));

      return {
        mesNumero,
        mesIso,
        nome: MESES_NOMES[idx],
        dias: registros.length,
        cartao: round2(registros.reduce((acc, v) => acc + v.cartao, 0)),
        mesa: round2(registros.reduce((acc, v) => acc + v.mesa, 0)),
        ifood: round2(registros.reduce((acc, v) => acc + v.ifood, 0)),
        dinheiro: round2(registros.reduce((acc, v) => acc + v.dinheiro, 0)),
        totalBruto: round2(registros.reduce((acc, v) => acc + v.totalBruto, 0)),
        saida: round2(registros.reduce((acc, v) => acc + v.saida, 0)),
        totalLiquido: round2(registros.reduce((acc, v) => acc + v.totalLiquido, 0))
      };
    });

    const anualBruto = round2(dadosMeses.reduce((a, m) => a + m.totalBruto, 0));
    const anualSaida = round2(dadosMeses.reduce((a, m) => a + m.saida, 0));
    const anualLiquido = round2(dadosMeses.reduce((a, m) => a + m.totalLiquido, 0));
    const anualDias = dadosMeses.reduce((a, m) => a + m.dias, 0);

    const mesesComMovimento = dadosMeses.filter((m) => m.dias > 0);
    const mediaMensalLiquida = mesesComMovimento.length > 0
      ? round2(anualLiquido / mesesComMovimento.length)
      : 0;

    let melhorMes = null;
    mesesComMovimento.forEach((m) => {
      if (!melhorMes || m.totalLiquido > melhorMes.totalLiquido) {
        melhorMes = m;
      }
    });

    document.getElementById('anualTotalBruto').textContent = formatarMoeda(anualBruto);
    document.getElementById('anualTotalDias').textContent = `${anualDias} dias registrados em ${anoSelecionadoMensal}`;
    document.getElementById('anualTotalSaida').textContent = formatarMoeda(anualSaida);
    const elAnualLiquido = document.getElementById('anualTotalLiquido');
    elAnualLiquido.textContent = formatarMoeda(anualLiquido);
    elAnualLiquido.classList.toggle('text-negative', anualLiquido < 0);
    document.getElementById('anualMediaMensal').textContent = `Média mensal: ${formatarMoeda(mediaMensalLiquida)}`;

    if (melhorMes) {
      document.getElementById('anualMelhorMes').textContent = melhorMes.nome;
      document.getElementById('anualMelhorMesValor').textContent =
        `Líquido: ${formatarMoeda(melhorMes.totalLiquido)} (Bruto: ${formatarMoeda(melhorMes.totalBruto)})`;
    } else {
      document.getElementById('anualMelhorMes').textContent = '—';
      document.getElementById('anualMelhorMesValor').textContent = 'Sem lançamentos no ano';
    }

    const maiorLiquidoMes = Math.max(...dadosMeses.map((m) => Math.max(0, m.totalLiquido)), 1);
    const apenasComMovimento = chkApenasMesesComMovimento.checked;
    const listaExibida = apenasComMovimento ? mesesComMovimento : dadosMeses;

    const tbody = document.getElementById('tbodyMensal');
    tbody.innerHTML = '';

    if (listaExibida.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-muted" style="padding: 24px;">
            Nenhum lançamento encontrado para o ano de ${anoSelecionadoMensal}.
          </td>
        </tr>
      `;
    } else {
      listaExibida.forEach((m) => {
        const tr = document.createElement('tr');
        if (m.dias === 0) tr.className = 'row-empty-month';
        const pctBarra = m.totalLiquido > 0 ? Math.min(100, Math.round((m.totalLiquido / maiorLiquidoMes) * 100)) : 0;

        tr.innerHTML = `
          <td>
            <div class="month-cell">
              <span class="month-name">${m.nome}</span>
              <div class="month-bar-track">
                <div class="month-bar-fill" style="width: ${pctBarra}%"></div>
              </div>
            </div>
          </td>
          <td class="text-center">${m.dias}</td>
          <td class="text-right">${formatarMoeda(m.cartao)}</td>
          <td class="text-right">${formatarMoeda(m.mesa)}</td>
          <td class="text-right">${formatarMoeda(m.ifood)}</td>
          <td class="text-right">${formatarMoeda(m.dinheiro)}</td>
          <td class="text-right"><strong>${formatarMoeda(m.totalBruto)}</strong></td>
          <td class="text-right text-saida">${m.saida > 0 ? `-${formatarMoeda(m.saida)}` : formatarMoeda(0)}</td>
          <td class="text-right"><strong class="${m.totalLiquido < 0 ? 'text-negative' : ''}">${formatarMoeda(m.totalLiquido)}</strong></td>
          <td class="text-center no-print">
            <button type="button" class="btn btn-sm btn-ghost btn-ver-mes" data-mes="${m.mesIso}">
              🔍 Ver dias
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    tbody.querySelectorAll('.btn-ver-mes').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mesIso = btn.dataset.mes;
        filtroTipoPeriodo.value = 'mes';
        filtroMesAno.value = mesIso;
        atualizarVisibilidadeFiltros();
        ativarAba('tab-historico');
      });
    });

    const tfoot = document.getElementById('tfootMensal');
    const somaCartao = round2(dadosMeses.reduce((a, m) => a + m.cartao, 0));
    const somaMesa = round2(dadosMeses.reduce((a, m) => a + m.mesa, 0));
    const somaIfood = round2(dadosMeses.reduce((a, m) => a + m.ifood, 0));
    const somaDinheiro = round2(dadosMeses.reduce((a, m) => a + m.dinheiro, 0));

    tfoot.innerHTML = `
      <tr>
        <td>TOTAL ${anoSelecionadoMensal}</td>
        <td class="text-center">${anualDias}</td>
        <td class="text-right">${formatarMoeda(somaCartao)}</td>
        <td class="text-right">${formatarMoeda(somaMesa)}</td>
        <td class="text-right">${formatarMoeda(somaIfood)}</td>
        <td class="text-right">${formatarMoeda(somaDinheiro)}</td>
        <td class="text-right text-bruto">${formatarMoeda(anualBruto)}</td>
        <td class="text-right text-saida">-${formatarMoeda(anualSaida)}</td>
        <td class="text-right ${anualLiquido < 0 ? 'text-negative' : ''}">${formatarMoeda(anualLiquido)}</td>
        <td class="no-print"></td>
      </tr>
    `;
  }

  // ABA 3: Histórico & Relatórios
  const filtroTipoPeriodo = document.getElementById('filtroTipoPeriodo');
  const filtroMesAno = document.getElementById('filtroMesAno');
  const filtroDataInicio = document.getElementById('filtroDataInicio');
  const filtroDataFim = document.getElementById('filtroDataFim');
  const filtroBusca = document.getElementById('filtroBusca');
  const boxFiltroMes = document.getElementById('boxFiltroMes');
  const boxFiltroIntervalo = document.getElementById('boxFiltroIntervalo');

  function atualizarVisibilidadeFiltros() {
    const tipo = filtroTipoPeriodo.value;
    boxFiltroMes.classList.toggle('hidden', tipo !== 'mes');
    boxFiltroIntervalo.classList.toggle('hidden', tipo !== 'intervalo');
  }

  [filtroTipoPeriodo, filtroMesAno, filtroDataInicio, filtroDataFim, filtroBusca].forEach((el) => {
    el.addEventListener('input', () => {
      atualizarVisibilidadeFiltros();
      renderizarAbaHistorico();
    });
    el.addEventListener('change', () => {
      atualizarVisibilidadeFiltros();
      renderizarAbaHistorico();
    });
  });

  document.getElementById('btnImprimirRelatorio').addEventListener('click', () => {
    window.print();
  });

  function obterVendasFiltradasHistorico() {
    const tipo = filtroTipoPeriodo.value;
    const termo = filtroBusca.value.trim().toLowerCase();

    return vendas.filter((item) => {
      if (tipo === 'mes' && filtroMesAno.value) {
        if (!item.data.startsWith(filtroMesAno.value)) return false;
      } else if (tipo === 'intervalo') {
        if (filtroDataInicio.value && item.data < filtroDataInicio.value) return false;
        if (filtroDataFim.value && item.data > filtroDataFim.value) return false;
      }

      if (termo) {
        const dataBR = formatarDataBR(item.data).toLowerCase();
        const obs = (item.observacao || '').toLowerCase();
        if (!dataBR.includes(termo) && !obs.includes(termo) && !item.data.includes(termo)) {
          return false;
        }
      }

      return true;
    });
  }

  function renderizarAbaHistorico() {
    const lista = obterVendasFiltradasHistorico();

    const somaCartao = round2(lista.reduce((a, v) => a + v.cartao, 0));
    const somaMesa = round2(lista.reduce((a, v) => a + v.mesa, 0));
    const somaIfood = round2(lista.reduce((a, v) => a + v.ifood, 0));
    const somaDinheiro = round2(lista.reduce((a, v) => a + v.dinheiro, 0));
    const somaBruto = round2(lista.reduce((a, v) => a + v.totalBruto, 0));
    const somaSaida = round2(lista.reduce((a, v) => a + v.saida, 0));
    const somaLiquido = round2(lista.reduce((a, v) => a + v.totalLiquido, 0));

    const qtd = lista.length;
    const mediaLiquidaDia = qtd > 0 ? round2(somaLiquido / qtd) : 0;
    const pctSaidaSobreBruto = somaBruto > 0 ? ((somaSaida / somaBruto) * 100).toFixed(1) : '0.0';

    document.getElementById('relTotalBruto').textContent = formatarMoeda(somaBruto);
    document.getElementById('relQtdDias').textContent = `${qtd} ${qtd === 1 ? 'dia lançado' : 'dias lançados'}`;
    document.getElementById('relTotalSaida').textContent = formatarMoeda(somaSaida);
    document.getElementById('relPercentualSaida').textContent = `${pctSaidaSobreBruto}% sobre o bruto`;

    const elRelLiquido = document.getElementById('relTotalLiquido');
    elRelLiquido.textContent = formatarMoeda(somaLiquido);
    elRelLiquido.classList.toggle('text-negative', somaLiquido < 0);
    document.getElementById('relMediaDiaria').textContent = `Média líquida/dia: ${formatarMoeda(mediaLiquidaDia)}`;

    const categorias = [
      { nome: 'Cartão', valor: somaCartao, cor: 'var(--color-cartao)' },
      { nome: 'Mesa', valor: somaMesa, cor: 'var(--color-mesa)' },
      { nome: 'iFood', valor: somaIfood, cor: 'var(--color-ifood)' },
      { nome: 'Dinheiro', valor: somaDinheiro, cor: 'var(--color-dinheiro)' }
    ];

    const containerBarras = document.getElementById('relBarrasCategorias');
    containerBarras.innerHTML = '';

    categorias.forEach((cat) => {
      const pct = somaBruto > 0 ? (cat.valor / somaBruto) * 100 : 0;
      const box = document.createElement('div');
      box.className = 'cat-box';
      box.innerHTML = `
        <div class="cat-box-header">
          <span>${cat.nome}</span>
          <span>${pct.toFixed(1)}%</span>
        </div>
        <div class="cat-box-value">${formatarMoeda(cat.valor)}</div>
        <div class="cat-progress">
          <div class="cat-progress-fill" style="width: ${Math.min(100, pct)}%; background: ${cat.cor};"></div>
        </div>
      `;
      containerBarras.appendChild(box);
    });

    let descPeriodo = 'Exibindo todo o histórico';
    if (filtroTipoPeriodo.value === 'mes' && filtroMesAno.value) {
      const [a, m] = filtroMesAno.value.split('-').map(Number);
      descPeriodo = `Período: ${MESES_NOMES[m - 1]} de ${a}`;
    } else if (filtroTipoPeriodo.value === 'intervalo') {
      const ini = filtroDataInicio.value ? formatarDataBR(filtroDataInicio.value) : 'Início';
      const fim = filtroDataFim.value ? formatarDataBR(filtroDataFim.value) : 'Hoje';
      descPeriodo = `Período: ${ini} até ${fim}`;
    }
    document.getElementById('subtituloListaHistorico').textContent = descPeriodo;
    document.getElementById('printPeriodoLabel').textContent = descPeriodo;

    const tbody = document.getElementById('tbodyHistorico');
    tbody.innerHTML = '';

    if (lista.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-muted" style="padding: 24px;">
            Nenhum lançamento encontrado para este filtro.
          </td>
        </tr>
      `;
    } else {
      lista.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <strong>${formatarDataBR(item.data)}</strong>
            <span class="text-muted small">(${obterDiaSemanaCurto(item.data)})</span>
          </td>
          <td class="text-right">${formatarMoeda(item.cartao)}</td>
          <td class="text-right">${formatarMoeda(item.mesa)}</td>
          <td class="text-right">${formatarMoeda(item.ifood)}</td>
          <td class="text-right">${formatarMoeda(item.dinheiro)}</td>
          <td class="text-right"><strong>${formatarMoeda(item.totalBruto)}</strong></td>
          <td class="text-right text-saida">${item.saida > 0 ? `-${formatarMoeda(item.saida)}` : formatarMoeda(0)}</td>
          <td class="text-right"><strong class="${item.totalLiquido < 0 ? 'text-negative' : ''}">${formatarMoeda(item.totalLiquido)}</strong></td>
          <td class="obs-cell" title="${(item.observacao || '').replace(/"/g, '&quot;')}">${item.observacao || '—'}</td>
          <td class="text-center no-print">
            <button type="button" class="btn btn-sm btn-ghost btn-edit-row" data-id="${item.id}" title="Editar">✏️</button>
            <button type="button" class="btn btn-sm btn-ghost btn-del-row" data-id="${item.id}" title="Excluir">🗑️</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    tbody.querySelectorAll('.btn-edit-row').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalEdicao(btn.dataset.id));
    });

    tbody.querySelectorAll('.btn-del-row').forEach((btn) => {
      btn.addEventListener('click', () => confirmarExclusao(btn.dataset.id));
    });

    const tfoot = document.getElementById('tfootHistorico');
    tfoot.innerHTML = `
      <tr>
        <td>TOTAL (${qtd} ${qtd === 1 ? 'dia' : 'dias'})</td>
        <td class="text-right">${formatarMoeda(somaCartao)}</td>
        <td class="text-right">${formatarMoeda(somaMesa)}</td>
        <td class="text-right">${formatarMoeda(somaIfood)}</td>
        <td class="text-right">${formatarMoeda(somaDinheiro)}</td>
        <td class="text-right text-bruto">${formatarMoeda(somaBruto)}</td>
        <td class="text-right text-saida">-${formatarMoeda(somaSaida)}</td>
        <td class="text-right ${somaLiquido < 0 ? 'text-negative' : ''}">${formatarMoeda(somaLiquido)}</td>
        <td colspan="2"></td>
      </tr>
    `;
  }

  // Modal de Edição
  const modalEdicao = document.getElementById('modalEdicao');
  const formModalEdicao = document.getElementById('formModalEdicao');
  const modalEditId = document.getElementById('modalEditId');
  const modalEditData = document.getElementById('modalEditData');
  const modalEditCartao = document.getElementById('modalEditCartao');
  const modalEditMesa = document.getElementById('modalEditMesa');
  const modalEditIfood = document.getElementById('modalEditIfood');
  const modalEditDinheiro = document.getElementById('modalEditDinheiro');
  const modalEditSaida = document.getElementById('modalEditSaida');
  const modalEditObs = document.getElementById('modalEditObs');
  const modalPreviewBruto = document.getElementById('modalPreviewBruto');
  const modalPreviewLiquido = document.getElementById('modalPreviewLiquido');

  function atualizarPreviewModal() {
    const bruto = round2(
      parseMoeda(modalEditCartao.value) +
      parseMoeda(modalEditMesa.value) +
      parseMoeda(modalEditIfood.value) +
      parseMoeda(modalEditDinheiro.value)
    );
    const saida = parseMoeda(modalEditSaida.value);
    const liquido = round2(bruto - saida);
    modalPreviewBruto.textContent = formatarMoeda(bruto);
    modalPreviewLiquido.textContent = formatarMoeda(liquido);
  }

  [modalEditCartao, modalEditMesa, modalEditIfood, modalEditDinheiro, modalEditSaida].forEach((el) => {
    el.addEventListener('input', atualizarPreviewModal);
  });

  function abrirModalEdicao(id) {
    const item = vendas.find((v) => v.id === id);
    if (!item) return;

    modalEditId.value = item.id;
    modalEditData.value = item.data;
    modalEditCartao.value = formatarNumeroInput(item.cartao);
    modalEditMesa.value = formatarNumeroInput(item.mesa);
    modalEditIfood.value = formatarNumeroInput(item.ifood);
    modalEditDinheiro.value = formatarNumeroInput(item.dinheiro);
    modalEditSaida.value = formatarNumeroInput(item.saida);
    modalEditObs.value = item.observacao || '';

    atualizarPreviewModal();
    modalEdicao.classList.remove('hidden');
  }

  function fecharModalEdicao() {
    modalEdicao.classList.add('hidden');
  }

  document.getElementById('btnFecharModalEdicao').addEventListener('click', fecharModalEdicao);
  document.getElementById('btnCancelarModalEdicao').addEventListener('click', fecharModalEdicao);

  formModalEdicao.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = modalEditId.value;
    const itemExistente = vendas.find((v) => v.id === id);
    if (!itemExistente) return;

    await salvarRegistroNoBanco({
      id,
      data: modalEditData.value,
      cartao: parseMoeda(modalEditCartao.value),
      mesa: parseMoeda(modalEditMesa.value),
      ifood: parseMoeda(modalEditIfood.value),
      dinheiro: parseMoeda(modalEditDinheiro.value),
      saida: parseMoeda(modalEditSaida.value),
      observacao: modalEditObs.value.trim()
    });

    fecharModalEdicao();
    mostrarToast('Lançamento atualizado em todos os aparelhos!');
  });

  document.getElementById('btnExcluirDoModal').addEventListener('click', async () => {
    const id = modalEditId.value;
    const excluiu = await confirmarExclusao(id);
    if (excluiu) {
      fecharModalEdicao();
    }
  });

  async function confirmarExclusao(id) {
    const item = vendas.find((v) => v.id === id);
    if (!item) return false;

    const ok = window.confirm(
      `Tem certeza que deseja excluir o fechamento do dia ${formatarDataBR(item.data)} (${formatarMoeda(item.totalLiquido)})?`
    );
    if (!ok) return false;

    await removerRegistroDoBanco(id);
    mostrarToast('Lançamento excluído.');
    return true;
  }

  // Exportação CSV e Backup JSON
  function exportarCSV() {
    if (vendas.length === 0) {
      mostrarToast('Não há lançamentos para exportar.', 'error');
      return;
    }

    const cabecalho = [
      'Data',
      'Cartao (R$)',
      'Mesa (R$)',
      'iFood (R$)',
      'Dinheiro (R$)',
      'Total Bruto (R$)',
      'Saida (R$)',
      'Total Liquido (R$)',
      'Observacao'
    ];

    const linhas = vendas.map((v) => [
      formatarDataBR(v.data),
      v.cartao.toFixed(2).replace('.', ','),
      v.mesa.toFixed(2).replace('.', ','),
      v.ifood.toFixed(2).replace('.', ','),
      v.dinheiro.toFixed(2).replace('.', ','),
      v.totalBruto.toFixed(2).replace('.', ','),
      v.saida.toFixed(2).replace('.', ','),
      v.totalLiquido.toFixed(2).replace('.', ','),
      `"${(v.observacao || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [cabecalho.join(';'), ...linhas.map((l) => l.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendas-restaurante-${hojeISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast('Planilha CSV exportada!');
  }

  function exportarBackupJSON() {
    const payload = {
      app: 'caixa-diario-restaurante',
      versao: 1,
      exportadoEm: new Date().toISOString(),
      registros: vendas
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-vendas-restaurante-${hojeISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast('Backup JSON baixado com sucesso!');
  }

  // Modal Backup
  const modalBackup = document.getElementById('modalBackup');
  document.getElementById('btnBackupModal').addEventListener('click', () => {
    modalBackup.classList.remove('hidden');
  });
  document.getElementById('btnFecharModalBackup').addEventListener('click', () => {
    modalBackup.classList.add('hidden');
  });
  document.getElementById('btnExportCSV').addEventListener('click', exportarCSV);
  document.getElementById('btnDownloadBackupCsv').addEventListener('click', exportarCSV);
  document.getElementById('btnDownloadBackupJson').addEventListener('click', exportarBackupJSON);

  document.getElementById('inputFileBackup').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const listaImportada = Array.isArray(parsed) ? parsed : parsed.registros;
        if (!Array.isArray(listaImportada)) {
          throw new Error('Formato inválido');
        }

        const registrosValidos = listaImportada
          .filter((item) => item && typeof item.data === 'string')
          .map(normalizarRegistro);

        for (const reg of registrosValidos) {
          await salvarRegistroNoBanco(reg);
        }

        modalBackup.classList.add('hidden');
        mostrarToast(`${registrosValidos.length} registros restaurados e sincronizados!`);
      } catch (err) {
        mostrarToast('Arquivo de backup inválido.', 'error');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  [modalEdicao, modalBackup].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  function renderizarTudo() {
    verificarDataExistente();
    renderizarAbaLancamento();
    renderizarAbaMensal();
    renderizarAbaHistorico();
  }

  // Inicialização
  function init() {
    carregarDadosLocais();
    inputData.value = hojeISO();
    filtroMesAno.value = mesAtualISO();
    atualizarVisibilidadeFiltros();
    atualizarPreviewFormulario();
    renderizarTudo();
    iniciarSincronizacaoNuvem();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
