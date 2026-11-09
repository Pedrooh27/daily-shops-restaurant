# Caixa Diário — Controle de Vendas do Restaurante

Aplicativo Web Responsivo (PWA) para controle de fechamento de caixa diário e faturamento mensal do restaurante, com sincronização em tempo real na nuvem via **Firebase Cloud Firestore** e hospedado na **Vercel**.

🌐 **Link de Produção:** [https://vendas-restaurante.vercel.app](https://vendas-restaurante.vercel.app)

## Funcionalidades

- **📝 Fechamento do Dia**:
  - Entradas: **Cartão (R$)**, **Mesa (R$)**, **iFood (R$)** e **Dinheiro (R$)**.
  - Despesas: **Saída (R$)** e campo de observação opcional.
  - Cálculo automático de **Total Bruto** e **Total Líquido**.
- **📅 Faturamento Mês a Mês**:
  - Visão consolidada de todos os meses do ano com total bruto, saídas, total líquido, média mensal e destaque do melhor mês.
- **📈 Histórico & Relatórios**:
  - Filtros por mês/ano, intervalo de datas ou busca por texto/data.
  - Edição e exclusão de lançamentos e impressão/exportação para PDF.
- **☁️ Sincronização em Tempo Real & Backup**:
  - Sincronização instantânea entre múltiplos celulares e computadores via **Firebase Cloud Firestore** + cache offline (`localStorage`).
  - Exportação de planilha **CSV (Excel)** e backup completo em **JSON**.
