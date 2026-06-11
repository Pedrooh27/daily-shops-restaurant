import 'dart:convert';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  runApp(const OpniaoRestauranteApp());
}

class OpniaoRestauranteApp extends StatelessWidget {
  const OpniaoRestauranteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Controle de Vendas',
      theme: ThemeData(
        primarySwatch: Colors.green,
        scaffoldBackgroundColor: Colors.grey[100],
      ),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('pt', 'BR'),
        Locale('en', 'US'),
      ],
      home: const DashboardVendas(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class VendaDiaria {
  VendaDiaria({
    required this.data,
    required this.cartao,
    required this.mesa,
    required this.ifood,
    required this.dinheiro,
    required this.saida,
  });

  final DateTime data;
  final double cartao;
  final double mesa;
  final double ifood;
  final double dinheiro;
  final double saida;

  double get totalLiquido => (cartao + mesa + ifood + dinheiro) - saida;

  Map<String, dynamic> toMap() {
    return {
      'data': data.toIso8601String(),
      'cartao': cartao,
      'mesa': mesa,
      'ifood': ifood,
      'dinheiro': dinheiro,
      'saida': saida,
    };
  }

  static VendaDiaria fromMap(Map<String, dynamic> map) {
    return VendaDiaria(
      data: DateTime.parse(map['data'] as String),
      cartao: (map['cartao'] as num?)?.toDouble() ?? 0,
      mesa: (map['mesa'] as num?)?.toDouble() ?? 0,
      ifood: (map['ifood'] as num?)?.toDouble() ?? 0,
      dinheiro: (map['dinheiro'] as num?)?.toDouble() ?? 0,
      saida: (map['saida'] as num?)?.toDouble() ?? 0,
    );
  }
}

class VendasStorage {
  static const _storageKey = 'historico_vendas';

  static Future<List<VendaDiaria>> carregar() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = prefs.getStringList(_storageKey) ?? [];

    final vendas = <VendaDiaria>[];
    for (final jsonItem in jsonList) {
      try {
        vendas.add(VendaDiaria.fromMap(jsonDecode(jsonItem) as Map<String, dynamic>));
      } on FormatException catch (error) {
        debugPrint('Registro inválido ignorado: $error');
      } on TypeError catch (error) {
        debugPrint('Registro inválido ignorado: $error');
      } catch (error) {
        debugPrint('Falha ao carregar registro salvo: $error');
        continue;
      }
    }

    vendas.sort((a, b) => b.data.compareTo(a.data));
    return vendas;
  }

  static Future<void> salvar(List<VendaDiaria> vendas) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = vendas.map((venda) => jsonEncode(venda.toMap())).toList();
    await prefs.setStringList(_storageKey, payload);
  }
}

enum PeriodoRelatorio { semana, mes }

class DashboardVendas extends StatefulWidget {
  const DashboardVendas({super.key});

  @override
  State<DashboardVendas> createState() => _DashboardVendasState();
}

class _DashboardVendasState extends State<DashboardVendas> {
  final _cartaoController = TextEditingController();
  final _mesaController = TextEditingController();
  final _ifoodController = TextEditingController();
  final _dinheiroController = TextEditingController();
  final _saidaController = TextEditingController();

  final NumberFormat _currency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  List<VendaDiaria> _historicoVendas = [];
  double _totalDia = 0;
  bool _loading = true;
  int _currentTab = 0;

  PeriodoRelatorio _periodoSelecionado = PeriodoRelatorio.semana;
  DateTime _dataReferencia = DateTime.now();

  @override
  void initState() {
    super.initState();
    _carregarVendas();
  }

  @override
  void dispose() {
    _cartaoController.dispose();
    _mesaController.dispose();
    _ifoodController.dispose();
    _dinheiroController.dispose();
    _saidaController.dispose();
    super.dispose();
  }

  Future<void> _carregarVendas() async {
    final vendas = await VendasStorage.carregar();
    setState(() {
      _historicoVendas = vendas;
      _loading = false;
    });
  }

  double _parseValor(String value) {
    final normalizado = value.replaceAll(',', '.').trim();
    return double.tryParse(normalizado) ?? 0;
  }

  void _calcularTotal() {
    final cartao = _parseValor(_cartaoController.text);
    final mesa = _parseValor(_mesaController.text);
    final ifood = _parseValor(_ifoodController.text);
    final dinheiro = _parseValor(_dinheiroController.text);
    final saida = _parseValor(_saidaController.text);

    setState(() {
      _totalDia = (cartao + mesa + ifood + dinheiro) - saida;
    });
  }

  Future<void> _salvarDados() async {
    _calcularTotal();

    final venda = VendaDiaria(
      data: DateTime.now(),
      cartao: _parseValor(_cartaoController.text),
      mesa: _parseValor(_mesaController.text),
      ifood: _parseValor(_ifoodController.text),
      dinheiro: _parseValor(_dinheiroController.text),
      saida: _parseValor(_saidaController.text),
    );

    setState(() {
      _historicoVendas = [venda, ..._historicoVendas];
      _cartaoController.clear();
      _mesaController.clear();
      _ifoodController.clear();
      _dinheiroController.clear();
      _saidaController.clear();
      _totalDia = 0;
    });

    await VendasStorage.salvar(_historicoVendas);

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Venda salva com sucesso!')),
    );
  }

  Future<void> _selecionarDataReferencia() async {
    final novaData = await showDatePicker(
      context: context,
      initialDate: _dataReferencia,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      locale: const Locale('pt', 'BR'),
    );

    if (novaData == null) return;

    setState(() {
      _dataReferencia = novaData;
    });
  }

  DateTime _inicioSemana(DateTime data) {
    return DateTime(data.year, data.month, data.day)
        .subtract(Duration(days: data.weekday - DateTime.monday));
  }

  List<VendaDiaria> _vendasDoPeriodo() {
    final ref = _dataReferencia;

    if (_periodoSelecionado == PeriodoRelatorio.mes) {
      return _historicoVendas
          .where((v) => v.data.year == ref.year && v.data.month == ref.month)
          .toList();
    }

    final inicioSemana = _inicioSemana(ref);
    final fimSemanaExclusivo = inicioSemana.add(const Duration(days: 7));

    return _historicoVendas
        .where((v) => !v.data.isBefore(inicioSemana) && v.data.isBefore(fimSemanaExclusivo))
        .toList();
  }

  Widget _buildDashboardTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Lançamento Diário',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 16),
                  _buildCampoTexto(_cartaoController, 'Cartão (R\$)', Colors.blue),
                  _buildCampoTexto(_mesaController, 'Mesa (R\$)', Colors.orange),
                  _buildCampoTexto(_ifoodController, 'iFood (R\$)', Colors.red),
                  _buildCampoTexto(_dinheiroController, 'Dinheiro (R\$)', Colors.green),
                  _buildCampoTexto(_saidaController, 'Saída / Despesas (R\$)', Colors.purple),
                  const SizedBox(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total Líquido:',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
                      ),
                      Text(
                        _currency.format(_totalDia),
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: Colors.green[800],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _salvarDados,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green[700],
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Center(
                      child: Text(
                        'Salvar Fechamento',
                        style: TextStyle(fontSize: 16),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Últimos Lançamentos',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          if (_historicoVendas.isEmpty)
            const Card(
              child: ListTile(title: Text('Nenhum lançamento salvo ainda.')),
            )
          else
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _historicoVendas.length,
              itemBuilder: (context, index) {
                final item = _historicoVendas[index];
                return Card(
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  child: ListTile(
                    leading: const Icon(Icons.calendar_today, color: Colors.grey),
                    title: Text(DateFormat('dd/MM/yyyy').format(item.data)),
                    trailing: Text(
                      _currency.format(item.totalLiquido),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.black87,
                      ),
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildPeriodoHeader() {
    final label = _periodoSelecionado == PeriodoRelatorio.mes
        ? DateFormat('MMMM/yyyy', 'pt_BR').format(_dataReferencia)
        : 'Semana de ${DateFormat('dd/MM/yyyy').format(_inicioSemana(_dataReferencia))}';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: SegmentedButton<PeriodoRelatorio>(
                    segments: const [
                      ButtonSegment(
                        value: PeriodoRelatorio.semana,
                        label: Text('Semana'),
                        icon: Icon(Icons.date_range),
                      ),
                      ButtonSegment(
                        value: PeriodoRelatorio.mes,
                        label: Text('Mês'),
                        icon: Icon(Icons.calendar_month),
                      ),
                    ],
                    selected: {_periodoSelecionado},
                    onSelectionChanged: (selection) {
                      setState(() {
                        _periodoSelecionado = selection.first;
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600))),
                TextButton.icon(
                  onPressed: _selecionarDataReferencia,
                  icon: const Icon(Icons.edit_calendar),
                  label: const Text('Escolher'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRelatoriosTab() {
    final vendas = _vendasDoPeriodo();
    final total = vendas.fold<double>(0, (acc, venda) => acc + venda.totalLiquido);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildPeriodoHeader(),
          const SizedBox(height: 12),
          Card(
            color: Colors.green[700],
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const Text('Faturamento do período', style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 8),
                  Text(
                    _currency.format(total),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.receipt_long),
              title: const Text('Lançamentos no período'),
              trailing: Text('${vendas.length}'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildGraficoTab() {
    final vendas = _vendasDoPeriodo();
    final totais = {
      'Cartão': vendas.fold<double>(0, (acc, venda) => acc + venda.cartao),
      'Mesa': vendas.fold<double>(0, (acc, venda) => acc + venda.mesa),
      'iFood': vendas.fold<double>(0, (acc, venda) => acc + venda.ifood),
      'Dinheiro': vendas.fold<double>(0, (acc, venda) => acc + venda.dinheiro),
    };

    final soma = totais.values.fold<double>(0, (a, b) => a + b);
    final cores = [Colors.blue, Colors.orange, Colors.red, Colors.green];
    final totalEntries = totais.entries.toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildPeriodoHeader(),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                height: 260,
                child: soma == 0
                    ? const Center(child: Text('Sem dados no período para exibir gráfico.'))
                    : PieChart(
                        PieChartData(
                          sectionsSpace: 2,
                          centerSpaceRadius: 36,
                          sections: List.generate(totalEntries.length, (index) {
                            final item = totalEntries[index];
                            final valor = item.value;
                            final percentual = (valor / soma) * 100;
                            return PieChartSectionData(
                              color: cores[index],
                              value: valor,
                              title: '${percentual.toStringAsFixed(1)}%',
                              radius: 90,
                              titleStyle: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 12,
                              ),
                            );
                          }).toList(),
                        ),
                      ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          ...List.generate(totalEntries.length, (index) {
            final item = totalEntries[index];
            return Card(
              child: ListTile(
                leading: CircleAvatar(backgroundColor: cores[index], radius: 8),
                title: Text(item.key),
                trailing: Text(_currency.format(item.value)),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    switch (_currentTab) {
      case 1:
        return _buildRelatoriosTab();
      case 2:
        return _buildGraficoTab();
      default:
        return _buildDashboardTab();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fechamento do Dia - Restaurante'),
        backgroundColor: Colors.green[700],
        foregroundColor: Colors.white,
      ),
      body: _buildBody(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentTab,
        onDestinationSelected: (index) {
          setState(() {
            _currentTab = index;
          });
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.point_of_sale),
            label: 'Lançamento',
          ),
          NavigationDestination(
            icon: Icon(Icons.assessment),
            label: 'Relatórios',
          ),
          NavigationDestination(
            icon: Icon(Icons.pie_chart),
            label: 'Gráficos',
          ),
        ],
      ),
    );
  }

  Widget _buildCampoTexto(TextEditingController controller, String label, Color corFoco) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: TextStyle(color: corFoco),
          border: const OutlineInputBorder(),
          focusedBorder: OutlineInputBorder(
            borderSide: BorderSide(color: corFoco, width: 2),
          ),
        ),
        onChanged: (_) => _calcularTotal(),
      ),
    );
  }
}
