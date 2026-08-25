/* ============================================================
   SISTEMA DE RACHAS - APP COMPLETO
   ============================================================ */

// ============================================================
// CONFIGURAÇÃO - PREENCHA COM SEUS DADOS DO SUPABASE
// ============================================================
const SUPABASE_URL = https://molgjdwraurvxffiuqki.supabase.co
const SUPABASE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vbGdqZHdyYXVydnhmZml1cWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODUzNzUsImV4cCI6MjEwMzI2MTM3NX0.pSZuxAIXTJUUBo9uyxNR3LvPkXTeW0k6u1-ico-YlQE

// ============================================================
// CLASSE PRINCIPAL
// ============================================================
class App {
    constructor() {
        this.supabase = null;
        this.user = null;
        this.profile = null;
        this.currentRacha = null;
        this.participations = [];
        this.receipts = [];
        this.currentScreen = 'loading';
        this.screenParams = {};
        this.realtimeSub = null;
        this.pollingInterval = null;
        this.navVisible = false;
    }

    async init() {
        this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
            this.user = session.user;
            await this.loadProfile();
        }

        this.supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                this.user = session.user;
                await this.loadProfile();
                this.navigate('home');
            } else if (event === 'SIGNED_OUT') {
                this.user = null;
                this.profile = null;
                this.navigate('auth');
            }
        });

        if (this.user) {
            await this.loadRachaData();
            this.navigate('home');
        } else {
            this.navigate('auth');
        }
    }

    // ============================================================
    // DADOS
    // ============================================================
    async loadProfile() {
        if (!this.user) return;
        const { data, error } = await this.supabase
            .from('profiles')
            .select('*')
            .eq('id', this.user.id)
            .single();
        if (!error && data) this.profile = data;
    }

    async loadRachaData() {
        if (!this.user) {
            this.currentRacha = null;
            this.participations = [];
            this.stopRealtime();
            return;
        }

        // Busca racha ativo (não finalizado)
        const { data: racha, error } = await this.supabase
            .from('rachas')
            .select('*, organizer:organizer_id(id, display_name, username)')
            .in('status', ['open', 'closed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!error && racha) {
            this.currentRacha = racha;
            await this.loadParticipations(racha.id);
            this.setupRealtime(racha.id);
        } else {
            this.currentRacha = null;
            this.participations = [];
            this.stopRealtime();
        }
    }

    async loadParticipations(rachaId) {
        const { data, error } = await this.supabase
            .from('participations')
            .select('*, player:player_id(id, display_name, username)')
            .eq('racha_id', rachaId)
            .order('joined_at', { ascending: true });

        if (!error && data) {
            this.participations = data;
            // Carrega comprovantes se for organizador
            if (this.isOrganizer()) {
                const { data: receipts } = await this.supabase
                    .from('receipts')
                    .select('*')
                    .in('participation_id', data.map(p => p.id));
                this.receipts = receipts || [];
            }
        }
    }

    setupRealtime(rachaId) {
        this.stopRealtime();

        this.realtimeSub = this.supabase
            .channel('racha-' + rachaId)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'participations',
                filter: 'racha_id=eq.' + rachaId
            }, (payload) => {
                this.handleRealtimeChange(payload);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'rachas',
                filter: 'id=eq.' + rachaId
            }, (payload) => {
                this.currentRacha = { ...this.currentRacha, ...payload.new };
                this.render();
            })
            .subscribe();
    }

    stopRealtime() {
        if (this.realtimeSub) {
            this.supabase.removeChannel(this.realtimeSub);
            this.realtimeSub = null;
        }
    }

    handleRealtimeChange(payload) {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT') {
            this.participations.push(newRow);
        } else if (eventType === 'UPDATE') {
            const idx = this.participations.findIndex(p => p.id === newRow.id);
            if (idx >= 0) this.participations[idx] = { ...this.participations[idx], ...newRow };
        } else if (eventType === 'DELETE') {
            this.participations = this.participations.filter(p => p.id !== oldRow.id);
        }

        this.render();
    }

    // ============================================================
    // NAVEGAÇÃO
    // ============================================================
    navigate(screen, params = {}) {
        this.currentScreen = screen;
        this.screenParams = params;
        this.navVisible = ['home', 'rankings', 'profile'].includes(screen);
        this.render();
        window.scrollTo(0, 0);
    }

    render() {
        const app = document.getElementById('app');
        let html = '';

        switch (this.currentScreen) {
            case 'loading': html = this.renderLoading(); break;
            case 'auth': html = this.renderAuth(); break;
            case 'home': html = this.renderHome(); break;
            case 'create-racha': html = this.renderCreateRacha(); break;
            case 'edit-racha': html = this.renderEditRacha(); break;
            case 'rankings': html = this.renderRankings(); break;
            case 'profile': html = this.renderProfile(); break;
            case 'finalize': html = this.renderFinalize(); break;
            case 'transfer': html = this.renderTransfer(); break;
            default: html = this.renderHome();
        }

        app.innerHTML = html;
        this.attachListeners();

        if (this.navVisible) {
            app.innerHTML += this.renderBottomNav();
            this.attachNavListeners();
        }
    }

    renderLoading() {
        return `<div id="loading-screen"><div class="loader">⚽</div><p>Carregando...</p></div>`;
    }

    // ============================================================
    // AUTH
    // ============================================================
    renderAuth() {
        return `
        <div class="fade-in">
            <div class="app-header" style="padding-top: 60px;">
                <h1>⚽ Rachas da Firma</h1>
                <p class="subtitle">Organize os jogos do trabalho</p>
            </div>
            <div class="card">
                <div class="tabs" id="auth-tabs">
                    <button class="tab-btn active" data-tab="login">Entrar</button>
                    <button class="tab-btn" data-tab="register">Criar conta</button>
                </div>
                <div id="auth-login">
                    <div class="form-group">
                        <label>Usuário</label>
                        <input type="text" id="login-user" placeholder="seu_usuario" autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label>Senha</label>
                        <input type="password" id="login-pass" placeholder="Sua senha" autocomplete="current-password">
                    </div>
                    <button class="btn btn-primary" id="btn-login">Entrar</button>
                </div>
                <div id="auth-register" style="display:none;">
                    <div class="form-group">
                        <label>Usuário</label>
                        <input type="text" id="reg-user" placeholder="seu_usuario" autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label>Nome</label>
                        <input type="text" id="reg-name" placeholder="Como quer ser chamado">
                    </div>
                    <div class="form-group">
                        <label>Senha</label>
                        <input type="password" id="reg-pass" placeholder="Crie uma senha" autocomplete="new-password">
                    </div>
                    <button class="btn btn-primary" id="btn-register">Criar conta</button>
                </div>
            </div>
        </div>`;
    }

    // ============================================================
    // HOME / RACHA ATUAL
    // ============================================================
    renderHome() {
        if (!this.currentRacha) {
            return this.renderNoRacha();
        }
        return this.renderRachaDetail();
    }

    renderNoRacha() {
        return `
        <div class="fade-in">
            <div class="app-header">
                <h1>⚽ Rachas da Firma</h1>
                <p class="subtitle">Nenhum racha ativo no momento</p>
            </div>
            <div class="empty-state">
                <div class="icon">😴</div>
                <p>Nenhum racha ativo.<br>Seja o primeiro a criar!</p>
                <button class="btn btn-primary" id="btn-create-racha">+ Criar Racha</button>
            </div>
        </div>`;
    }

    renderRachaDetail() {
        const r = this.currentRacha;
        const isOrg = this.isOrganizer();
        const myPart = this.getMyParticipation();
        const confirmed = this.participations.filter(p => p.status === 'confirmed');
        const awaiting = this.participations.filter(p => p.status === 'awaiting_payment');
        const furoes = this.participations.filter(p => p.status === 'furou');
        const removed = this.participations.filter(p => p.status === 'removed');
        const activeParts = this.participations.filter(p => p.status !== 'removed');

        const target = r.player_target;
        const current = confirmed.length;
        const pct = (current / target) * 100;
        const isMetaAtingida = current >= target;
        const barColor = isMetaAtingida 
            ? 'linear-gradient(90deg, #fbbf24, #f59e0b)' 
            : 'linear-gradient(90deg, var(--primary), #34d399)';

        const totalCollected = confirmed.reduce((s, p) => s + (p.amount_charged_cents || 0), 0);
        const excess = totalCollected - r.field_cost_cents;
        const deficit = r.field_cost_cents - totalCollected;

        let statusBadge = '';
        if (r.status === 'open') statusBadge = '<span class="badge badge-confirmed">🟢 Inscrições abertas</span>';
        else if (r.status === 'closed') statusBadge = '<span class="badge badge-awaiting">🔒 Inscrições encerradas</span>';

        let myStatusHtml = '';
        if (!myPart && r.status === 'open') {
            myStatusHtml = `<button class="btn btn-primary" id="btn-participar">Participar</button>`;
        } else if (myPart) {
            if (myPart.status === 'awaiting_payment' && r.payment_timing === 'before') {
                myStatusHtml = this.renderPaymentSection(myPart, r);
            } else if (myPart.status === 'confirmed') {
                myStatusHtml = `<div class="alert alert-success">✅ Você está confirmado!</div>`;
            } else if (myPart.status === 'furou') {
                myStatusHtml = `<div class="alert alert-warning">🐔 Você furou! Ainda pode pagar.</div>` + this.renderPaymentSection(myPart, r);
            } else if (myPart.status === 'removed') {
                myStatusHtml = `<div class="alert alert-danger">❌ Você foi removido deste racha.</div>`;
            }
        }

        let financeHtml = '';
        if (r.payment_timing === 'before' && r.price_per_person_cents) {
            financeHtml = `
            <div class="finance-box">
                <div class="finance-row"><span>Valor do campo</span><span>${this.formatMoney(r.field_cost_cents)}</span></div>
                <div class="finance-row"><span>Valor por pessoa</span><span>${this.formatMoney(r.price_per_person_cents)}</span></div>
                <div class="finance-row"><span>Arrecadado</span><span>${this.formatMoney(totalCollected)}</span></div>
                ${excess > 0 ? `<div class="finance-row total"><span>Excedente</span><span class="positive">+${this.formatMoney(excess)}</span></div>` : ''}
                ${deficit > 0 ? `<div class="finance-row total"><span>Déficit</span><span class="negative">-${this.formatMoney(deficit)}</span></div>` : ''}
            </div>`;

            if (isOrg && excess > 0) {
                const perPerson = Math.floor(excess / confirmed.length);
                financeHtml += `<div class="alert alert-success">💡 Excedente de ${this.formatMoney(excess)} ÷ ${confirmed.length} = ~${this.formatMoney(perPerson)} por pessoa</div>`;
            }
            if (deficit > 0) {
                financeHtml += `<div class="alert alert-warning">⚠️ Faltam ${this.formatMoney(deficit)} para cobrir o custo do campo.</div>`;
            }
        } else if (r.payment_timing === 'after') {
            const est = activeParts.length > 0 ? Math.ceil(r.field_cost_cents / activeParts.length) : 0;
            financeHtml = `
            <div class="finance-box">
                <div class="finance-row"><span>Valor do campo</span><span>${this.formatMoney(r.field_cost_cents)}</span></div>
                <div class="finance-row"><span>Valor estimado</span><span>~${this.formatMoney(est)}</span></div>
                <div class="finance-row"><span>Confirmados</span><span>${activeParts.length}</span></div>
            </div>`;
        }

        let orgActions = '';
        if (isOrg && r.status !== 'finished') {
            orgActions = `
            <div class="card">
                <div class="card-title">🔧 Ações do Organizador</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${r.status === 'open' ? `<button class="btn btn-warning" id="btn-close-insc">🔒 Encerrar inscrições</button>` : ''}
                    ${r.status === 'closed' ? `<button class="btn btn-info" id="btn-reopen-insc">🔓 Reabrir inscrições</button>` : ''}
                    <button class="btn btn-outline" id="btn-edit-racha">✏️ Editar racha</button>
                    <button class="btn btn-primary" id="btn-finalize">🏁 Finalizar racha</button>
                    <button class="btn btn-outline" id="btn-transfer">🔄 Transferir organização</button>
                </div>
            </div>`;
        }

        return `
        <div class="fade-in">
            <div class="app-header">
                <h1>⚽ Racha da Firma</h1>
                <p class="subtitle">${statusBadge}</p>
            </div>

            <div class="card">
                <div style="font-size:20px;font-weight:700;margin-bottom:4px;">${this.formatDate(r.match_date)} • ${r.match_time.slice(0,5)}</div>
                <div style="color:var(--text-muted);margin-bottom:12px;">📍 ${this.escapeHtml(r.location)}</div>

                ${r.notes ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;font-style:italic;">"${this.escapeHtml(r.notes)}"</div>` : ''}

                <div class="progress-section">
                    <div class="progress-header">
                        <span class="progress-label">🎯 Meta: ${target} jogadores</span>
                        <span class="progress-count"><span class="current">${current}</span><span class="target">/${target}</span></span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" style="width:${Math.min(Math.max(pct, 3), 100)}%;background:${barColor}"></div>
                    </div>
                    ${isMetaAtingida ? `<div class="progress-meta-atingida">🎉 META ATINGIDA! ${current > target ? '+' + (current - target) : ''}</div>` : ''}
                </div>

                ${financeHtml}
                ${myStatusHtml}
            </div>

            ${orgActions}

            ${confirmed.length > 0 ? `
            <div class="section-title">🟢 Confirmados (${confirmed.length})</div>
            <div class="card participant-list">
                ${confirmed.map(p => this.renderParticipant(p, isOrg)).join('')}
            </div>` : ''}

            ${awaiting.length > 0 ? `
            <div class="section-title">🟡 Aguardando pagamento (${awaiting.length})</div>
            <div class="card participant-list">
                ${awaiting.map(p => this.renderParticipant(p, isOrg)).join('')}
            </div>` : ''}

            ${furoes.length > 0 ? `
            <div class="section-title">🐔 Furões (${furoes.length})</div>
            <div class="card participant-list">
                ${furoes.map(p => this.renderParticipant(p, isOrg)).join('')}
            </div>` : ''}

            ${removed.length > 0 ? `
            <div class="section-title">❌ Removidos (${removed.length})</div>
            <div class="card participant-list">
                ${removed.map(p => this.renderParticipant(p, isOrg)).join('')}
            </div>` : ''}
        </div>`;
    }

    renderPaymentSection(part, racha) {
        return `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="text-align:center;margin-bottom:12px;">
                <div style="font-size:24px;font-weight:700;color:var(--primary);">${this.formatMoney(racha.price_per_person_cents)}</div>
                <div style="font-size:12px;color:var(--text-muted);">por pessoa</div>
            </div>
            ${racha.pix_key ? `
            <div class="form-group">
                <label>Chave Pix</label>
                <div style="display:flex;gap:8px;">
                    <input type="text" value="${this.escapeHtml(racha.pix_key)}" readonly style="flex:1;">
                    <button class="btn btn-sm btn-outline" id="btn-copy-pix" style="width:auto;flex-shrink:0;">Copiar</button>
                </div>
            </div>` : ''}
            <div class="receipt-upload" id="receipt-upload">
                <input type="file" id="receipt-file" accept="image/*,.pdf">
                <div class="icon">📎</div>
                <p>Toque para anexar comprovante</p>
            </div>
        </div>`;
    }

    renderParticipant(p, isOrg) {
        const initials = p.player.display_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        let badge = '';
        if (p.status === 'confirmed') badge = '<span class="badge badge-confirmed">✓</span>';
        else if (p.status === 'awaiting_payment') badge = '<span class="badge badge-awaiting">⏳</span>';
        else if (p.status === 'furou') badge = '<span class="badge badge-furou">🐔</span>';
        else if (p.status === 'removed') badge = '<span class="badge badge-removed">✕</span>';

        let actions = '';
        if (isOrg && p.status !== 'removed' && p.player_id !== this.user.id) {
            actions = `
            <div class="participant-actions">
                ${p.status !== 'removed' ? `<button class="btn btn-sm btn-danger" data-action="remove" data-id="${p.id}">Remover</button>` : ''}
            </div>`;
        }

        // Se for organizador, mostra comprovante
        let receiptBtn = '';
        if (isOrg && p.status === 'confirmed') {
            const receipt = this.receipts.find(r => r.participation_id === p.id);
            if (receipt) {
                receiptBtn = `<button class="btn btn-sm btn-outline" data-action="view-receipt" data-id="${receipt.id}">📎</button>`;
            }
        }

        return `
        <div class="participant-item">
            <div class="participant-info">
                <div class="participant-avatar">${initials}</div>
                <div>
                    <div class="participant-name">${this.escapeHtml(p.player.display_name)} ${badge}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${p.goals || 0} gols</div>
                </div>
            </div>
            <div class="participant-actions">
                ${receiptBtn}
                ${actions}
            </div>
        </div>`;
    }

    // ============================================================
    // CRIAR RACHA
    // ============================================================
    renderCreateRacha() {
        const today = new Date().toISOString().split('T')[0];
        return `
        <div class="fade-in">
            <div class="app-header">
                <button class="back-btn" id="btn-back">← Voltar</button>
                <h1>+ Criar Racha</h1>
            </div>
            <div class="card">
                <div class="form-group">
                    <label>Data</label>
                    <input type="date" id="racha-date" value="${today}">
                </div>
                <div class="form-group">
                    <label>Horário</label>
                    <input type="time" id="racha-time" value="20:00">
                </div>
                <div class="form-group">
                    <label>Local</label>
                    <input type="text" id="racha-location" placeholder="Ex: Arena X">
                </div>
                <div class="form-group">
                    <label>Valor do campo (R$)</label>
                    <input type="number" id="racha-cost" placeholder="240" min="0" step="0.01">
                </div>
                <div class="form-group">
                    <label>Meta de jogadores</label>
                    <input type="number" id="racha-target" placeholder="12" min="1" value="12">
                </div>
                <div class="form-group">
                    <label>Pagamento</label>
                    <div class="toggle-group">
                        <button class="toggle-btn active" data-value="before">Antes</button>
                        <button class="toggle-btn" data-value="after">Depois</button>
                    </div>
                </div>
                <div class="form-group" id="pix-group">
                    <label>Chave Pix</label>
                    <input type="text" id="racha-pix" placeholder="Sua chave Pix">
                </div>
                <div class="form-group">
                    <label>Observações</label>
                    <textarea id="racha-notes" placeholder="Algo importante sobre o racha..."></textarea>
                </div>
                <button class="btn btn-primary" id="btn-submit-racha">Criar Racha</button>
            </div>
        </div>`;
    }

    // ============================================================
    // EDITAR RACHA
    // ============================================================
    renderEditRacha() {
        const r = this.currentRacha;
        if (!r) return this.renderHome();
        return `
        <div class="fade-in">
            <div class="app-header">
                <button class="back-btn" id="btn-back">← Voltar</button>
                <h1>✏️ Editar Racha</h1>
            </div>
            <div class="card">
                <div class="form-group">
                    <label>Data</label>
                    <input type="date" id="edit-date" value="${r.match_date}">
                </div>
                <div class="form-group">
                    <label>Horário</label>
                    <input type="time" id="edit-time" value="${r.match_time.slice(0,5)}">
                </div>
                <div class="form-group">
                    <label>Local</label>
                    <input type="text" id="edit-location" value="${this.escapeHtml(r.location)}">
                </div>
                <div class="form-group">
                    <label>Valor do campo (R$)</label>
                    <input type="number" id="edit-cost" value="${(r.field_cost_cents/100).toFixed(2)}" min="0" step="0.01">
                </div>
                <div class="form-group">
                    <label>Meta de jogadores</label>
                    <input type="number" id="edit-target" value="${r.player_target}" min="1">
                </div>
                <div class="form-group">
                    <label>Chave Pix</label>
                    <input type="text" id="edit-pix" value="${this.escapeHtml(r.pix_key || '')}">
                </div>
                <div class="form-group">
                    <label>Observações</label>
                    <textarea id="edit-notes">${this.escapeHtml(r.notes || '')}</textarea>
                </div>
                <button class="btn btn-primary" id="btn-save-racha">Salvar alterações</button>
            </div>
        </div>`;
    }

    // ============================================================
    // RANKINGS
    // ============================================================
    renderRankings() {
        return `
        <div class="fade-in">
            <div class="app-header">
                <h1>🏆 Rankings</h1>
            </div>
            <div class="card">
                <div class="tabs" id="ranking-tabs">
                    <button class="tab-btn active" data-tab="gols">⚽ Gols</button>
                    <button class="tab-btn" data-tab="presenca">🏃 Presença</button>
                    <button class="tab-btn" data-tab="furoes">🐔 Furões</button>
                </div>
                <div id="ranking-content">
                    <div class="loading" style="text-align:center;padding:40px;">Carregando...</div>
                </div>
            </div>
        </div>`;
    }

    // ============================================================
    // PERFIL
    // ============================================================
    renderProfile() {
        if (!this.profile) return this.renderAuth();
        return `
        <div class="fade-in">
            <div class="app-header">
                <h1>👤 Perfil</h1>
            </div>
            <div class="card" style="text-align:center;padding:32px 20px;">
                <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--info));display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;margin:0 auto 16px;">
                    ${this.profile.display_name.slice(0,2).toUpperCase()}
                </div>
                <div style="font-size:20px;font-weight:700;margin-bottom:4px;">${this.escapeHtml(this.profile.display_name)}</div>
                <div style="color:var(--text-muted);font-size:14px;">@${this.escapeHtml(this.profile.username)}</div>
            </div>
            <div class="card">
                <div class="card-title">⚙️ Configurações</div>
                <div class="form-group">
                    <label>Nome</label>
                    <input type="text" id="profile-name" value="${this.escapeHtml(this.profile.display_name)}">
                </div>
                <button class="btn btn-primary" id="btn-save-profile">Salvar nome</button>
                <div class="divider"></div>
                <button class="btn btn-outline" id="btn-logout" style="color:var(--danger);border-color:var(--danger);">Sair da conta</button>
            </div>
        </div>`;
    }

    // ============================================================
    // FINALIZAR RACHA
    // ============================================================
    renderFinalize() {
        const r = this.currentRacha;
        if (!r) return this.renderHome();
        const activeParts = this.participations.filter(p => p.status !== 'removed');

        return `
        <div class="fade-in">
            <div class="app-header">
                <button class="back-btn" id="btn-back">← Voltar</button>
                <h1>🏁 Finalizar Racha</h1>
            </div>

            <div class="card">
                <div class="card-title">🏃 Presença</div>
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Marque quem realmente compareceu ao jogo.</p>
                <div class="participant-list">
                    ${activeParts.map(p => this.renderPresenceRow(p)).join('')}
                </div>
            </div>

            <div class="card">
                <div class="card-title">⚽ Gols</div>
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Informe quantos gols cada um marcou.</p>
                <div class="participant-list">
                    ${activeParts.map(p => this.renderGoalsRow(p)).join('')}
                </div>
            </div>

            ${r.payment_timing === 'after' ? `
            <div class="card">
                <div class="card-title">💰 Pagamentos</div>
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Marque quem já pagou.</p>
                <div class="participant-list">
                    ${activeParts.map(p => this.renderPaymentRow(p)).join('')}
                </div>
            </div>` : ''}

            <div class="card">
                <button class="btn btn-primary" id="btn-confirm-finalize">✅ Confirmar e finalizar</button>
            </div>
        </div>`;
    }

    renderPresenceRow(p) {
        return `
        <div class="participant-item" style="flex-wrap:wrap;">
            <div class="participant-info" style="flex:1;min-width:0;">
                <div class="participant-avatar">${p.player.display_name.slice(0,2).toUpperCase()}</div>
                <div class="participant-name">${this.escapeHtml(p.player.display_name)}</div>
            </div>
            <div class="presence-toggle" data-presence-id="${p.id}">
                <button class="presence-btn present ${p.presence === 'present' ? 'present' : ''}" data-value="present">Presente</button>
                <button class="presence-btn absent ${p.presence === 'absent' ? 'absent' : ''}" data-value="absent">Faltou</button>
            </div>
        </div>`;
    }

    renderGoalsRow(p) {
        return `
        <div class="participant-item">
            <div class="participant-info">
                <div class="participant-avatar">${p.player.display_name.slice(0,2).toUpperCase()}</div>
                <div class="participant-name">${this.escapeHtml(p.player.display_name)}</div>
            </div>
            <div class="goals-input" data-goals-id="${p.id}">
                <button data-delta="-1">−</button>
                <span class="goals-value">${p.goals || 0}</span>
                <button data-delta="1">+</button>
            </div>
        </div>`;
    }

    renderPaymentRow(p) {
        return `
        <div class="participant-item" style="flex-wrap:wrap;">
            <div class="participant-info" style="flex:1;min-width:0;">
                <div class="participant-avatar">${p.player.display_name.slice(0,2).toUpperCase()}</div>
                <div class="participant-name">${this.escapeHtml(p.player.display_name)}</div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" data-paid-id="${p.id}" ${p.paid_after ? 'checked' : ''}>
                <span style="font-size:13px;font-weight:600;">Pago</span>
            </label>
        </div>`;
    }

    // ============================================================
    // TRANSFERIR ORGANIZAÇÃO
    // ============================================================
    renderTransfer() {
        const r = this.currentRacha;
        if (!r) return this.renderHome();
        const confirmed = this.participations.filter(p => p.status === 'confirmed');

        return `
        <div class="fade-in">
            <div class="app-header">
                <button class="back-btn" id="btn-back">← Voltar</button>
                <h1>🔄 Transferir</h1>
            </div>
            <div class="card">
                <div class="card-title">Escolha o novo organizador</div>
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">Apenas confirmados podem receber a organização.</p>
                <div class="participant-list">
                    ${confirmed.filter(p => p.player_id !== this.user.id).map(p => `
                        <div class="participant-item" style="cursor:pointer;" data-transfer-id="${p.player_id}">
                            <div class="participant-info">
                                <div class="participant-avatar">${p.player.display_name.slice(0,2).toUpperCase()}</div>
                                <div class="participant-name">${this.escapeHtml(p.player.display_name)}</div>
                            </div>
                            <span style="color:var(--primary);font-weight:700;font-size:13px;">Selecionar →</span>
                        </div>
                    `).join('')}
                </div>
                ${confirmed.filter(p => p.player_id !== this.user.id).length === 0 ? 
                    '<div class="alert alert-warning">Nenhum outro confirmado para transferir.</div>' : ''}
            </div>
        </div>`;
    }

    // ============================================================
    // BOTTOM NAV
    // ============================================================
    renderBottomNav() {
        const active = this.currentScreen;
        return `
        <nav class="bottom-nav">
            <button class="nav-item ${active === 'home' ? 'active' : ''}" data-nav="home">
                <span class="icon">⚽</span>
                <span>Racha</span>
            </button>
            <button class="nav-item ${active === 'rankings' ? 'active' : ''}" data-nav="rankings">
                <span class="icon">🏆</span>
                <span>Rankings</span>
            </button>
            <button class="nav-item ${active === 'profile' ? 'active' : ''}" data-nav="profile">
                <span class="icon">👤</span>
                <span>Perfil</span>
            </button>
        </nav>`;
    }

    // ============================================================
    // HELPERS
    // ============================================================
    isOrganizer() {
        return this.currentRacha && this.user && this.currentRacha.organizer_id === this.user.id;
    }

    getMyParticipation() {
        if (!this.user) return null;
        return this.participations.find(p => p.player_id === this.user.id);
    }

    formatMoney(cents) {
        if (cents === null || cents === undefined) return 'R$ 0,00';
        return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
    }

    formatDate(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
        return dias[d.getDay()] + ' • ' + d.toLocaleDateString('pt-BR');
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',''':'&#39;'}[m]));
    }

    showToast(msg, type = 'success') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position:fixed;top:20px;left:50%;transform:translateX(-50%);
            background:${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--warning)'};
            color:white;padding:12px 24px;border-radius:12px;font-weight:600;z-index:1000;
            animation:fadeIn 0.3s ease-out;box-shadow:0 4px 12px rgba(0,0,0,0.3);
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================
    attachListeners() {
        // Auth tabs
        document.querySelectorAll('#auth-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#auth-tabs .tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none';
                document.getElementById('auth-register').style.display = tab === 'register' ? 'block' : 'none';
            });
        });

        // Login
        const btnLogin = document.getElementById('btn-login');
        if (btnLogin) {
            btnLogin.addEventListener('click', async () => {
                const user = document.getElementById('login-user').value.trim();
                const pass = document.getElementById('login-pass').value;
                if (!user || !pass) return this.showToast('Preencha usuário e senha', 'error');
                btnLogin.disabled = true;
                btnLogin.textContent = 'Entrando...';
                const { data, error } = await this.supabase.auth.signInWithPassword({
                    email: user + '@rachas.local',
                    password: pass
                });
                btnLogin.disabled = false;
                btnLogin.textContent = 'Entrar';
                if (error) this.showToast(error.message, 'error');
            });
        }

        // Register
        const btnReg = document.getElementById('btn-register');
        if (btnReg) {
            btnReg.addEventListener('click', async () => {
                const user = document.getElementById('reg-user').value.trim().toLowerCase();
                const name = document.getElementById('reg-name').value.trim();
                const pass = document.getElementById('reg-pass').value;
                if (!user || !name || !pass) return this.showToast('Preencha todos os campos', 'error');
                if (pass.length < 4) return this.showToast('Senha muito curta', 'error');
                btnReg.disabled = true;
                btnReg.textContent = 'Criando...';
                const { data, error } = await this.supabase.auth.signUp({
                    email: user + '@rachas.local',
                    password: pass,
                    options: { data: { username: user, display_name: name } }
                });
                btnReg.disabled = false;
                btnReg.textContent = 'Criar conta';
                if (error) this.showToast(error.message, 'error');
                else this.showToast('Conta criada! Entrando...');
            });
        }

        // Criar racha
        const btnCreate = document.getElementById('btn-create-racha');
        if (btnCreate) btnCreate.addEventListener('click', () => this.navigate('create-racha'));

        const btnBack = document.getElementById('btn-back');
        if (btnBack) btnBack.addEventListener('click', () => this.navigate('home'));

        // Toggle pagamento
        document.querySelectorAll('.toggle-group .toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = btn.closest('.toggle-group');
                group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const pixGroup = document.getElementById('pix-group');
                if (pixGroup) {
                    pixGroup.style.display = btn.dataset.value === 'before' ? 'block' : 'none';
                }
            });
        });

        // Submit criar racha
        const btnSubmit = document.getElementById('btn-submit-racha');
        if (btnSubmit) {
            btnSubmit.addEventListener('click', async () => {
                const date = document.getElementById('racha-date').value;
                const time = document.getElementById('racha-time').value;
                const location = document.getElementById('racha-location').value.trim();
                const cost = parseFloat(document.getElementById('racha-cost').value) || 0;
                const target = parseInt(document.getElementById('racha-target').value) || 12;
                const timing = document.querySelector('.toggle-group .toggle-btn.active')?.dataset.value || 'before';
                const pix = document.getElementById('racha-pix')?.value.trim() || '';
                const notes = document.getElementById('racha-notes').value.trim();

                if (!date || !time || !location) return this.showToast('Preencha data, horário e local', 'error');
                if (timing === 'before' && !pix) return this.showToast('Informe a chave Pix para pagamento antecipado', 'error');

                const costCents = Math.round(cost * 100);
                const pricePerPerson = timing === 'before' ? Math.round(costCents / target) : null;

                btnSubmit.disabled = true;
                const { data, error } = await this.supabase.from('rachas').insert({
                    organizer_id: this.user.id,
                    match_date: date,
                    match_time: time,
                    location,
                    field_cost_cents: costCents,
                    player_target: target,
                    payment_timing: timing,
                    pix_key: pix || null,
                    payment_info: null,
                    notes: notes || null,
                    price_per_person_cents: pricePerPerson,
                    status: 'open'
                }).select().single();

                if (error) {
                    btnSubmit.disabled = false;
                    return this.showToast(error.message, 'error');
                }

                // Organizador entra confirmado automaticamente (decisão 5B)
                await this.supabase.from('participations').insert({
                    racha_id: data.id,
                    player_id: this.user.id,
                    status: 'confirmed',
                    confirmed_at: new Date().toISOString(),
                    amount_charged_cents: pricePerPerson || 0
                });

                this.showToast('Racha criado!');
                await this.loadRachaData();
                this.navigate('home');
            });
        }

        // Editar racha
        const btnEdit = document.getElementById('btn-edit-racha');
        if (btnEdit) btnEdit.addEventListener('click', () => this.navigate('edit-racha'));

        const btnSaveEdit = document.getElementById('btn-save-racha');
        if (btnSaveEdit) {
            btnSaveEdit.addEventListener('click', async () => {
                const cost = parseFloat(document.getElementById('edit-cost').value) || 0;
                const updates = {
                    match_date: document.getElementById('edit-date').value,
                    match_time: document.getElementById('edit-time').value,
                    location: document.getElementById('edit-location').value.trim(),
                    field_cost_cents: Math.round(cost * 100),
                    player_target: parseInt(document.getElementById('edit-target').value) || 12,
                    pix_key: document.getElementById('edit-pix').value.trim() || null,
                    notes: document.getElementById('edit-notes').value.trim() || null
                };
                const { error } = await this.supabase.from('rachas').update(updates).eq('id', this.currentRacha.id);
                if (error) return this.showToast(error.message, 'error');
                this.showToast('Racha atualizado!');
                await this.loadRachaData();
                this.navigate('home');
            });
        }

        // Participar
        const btnPart = document.getElementById('btn-participar');
        if (btnPart) {
            btnPart.addEventListener('click', async () => {
                if (!this.currentRacha) return;
                const r = this.currentRacha;
                const status = r.payment_timing === 'before' ? 'awaiting_payment' : 'confirmed';
                const amount = r.payment_timing === 'before' ? (r.price_per_person_cents || 0) : 0;
                const confirmedAt = r.payment_timing === 'after' ? new Date().toISOString() : null;

                const { error } = await this.supabase.from('participations').insert({
                    racha_id: r.id,
                    player_id: this.user.id,
                    status,
                    amount_charged_cents: amount,
                    confirmed_at: confirmedAt
                });

                if (error) return this.showToast(error.message, 'error');
                this.showToast('Você entrou no racha!');
                await this.loadRachaData();
                this.render();
            });
        }

        // Copiar Pix
        const btnCopy = document.getElementById('btn-copy-pix');
        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                const pix = this.currentRacha?.pix_key;
                if (pix) {
                    navigator.clipboard.writeText(pix);
                    this.showToast('Pix copiado!');
                }
            });
        }

        // Upload comprovante
        const uploadArea = document.getElementById('receipt-upload');
        const fileInput = document.getElementById('receipt-file');
        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) return this.showToast('Arquivo muito grande (máx 2MB)', 'error');

                const myPart = this.getMyParticipation();
                if (!myPart) return;

                uploadArea.innerHTML = '<div class="icon">⏳</div><p>Enviando...</p>';

                const ext = file.name.split('.').pop();
                const path = `receipts/${this.currentRacha.id}/${myPart.id}_${Date.now()}.${ext}`;

                const { error: upError } = await this.supabase.storage
                    .from('receipts')
                    .upload(path, file, { contentType: file.type, upsert: true });

                if (upError) {
                    uploadArea.innerHTML = '<div class="icon">❌</div><p>Erro no upload</p>';
                    return this.showToast(upError.message, 'error');
                }

                const { error: dbError } = await this.supabase.from('receipts').insert({
                    participation_id: myPart.id,
                    file_path: path,
                    mime_type: file.type,
                    size_bytes: file.size
                });

                if (dbError) {
                    uploadArea.innerHTML = '<div class="icon">❌</div><p>Erro ao registrar</p>';
                    return this.showToast(dbError.message, 'error');
                }

                // Atualização otimista - a barra sobe na hora
                myPart.status = 'confirmed';
                myPart.confirmed_at = new Date().toISOString();
                this.render();
                this.showToast('Comprovante enviado! ✅ Confirmado');
                await this.loadRachaData();
            });
        }

        // Encerrar inscrições
        const btnClose = document.getElementById('btn-close-insc');
        if (btnClose) {
            btnClose.addEventListener('click', async () => {
                if (!confirm('Encerrar inscrições? Quem não pagou virará furão.')) return;
                const { error } = await this.supabase.from('rachas').update({ status: 'closed' }).eq('id', this.currentRacha.id);
                if (error) return this.showToast(error.message, 'error');
                this.showToast('Inscrições encerradas');
                await this.loadRachaData();
                this.render();
            });
        }

        // Reabrir inscrições
        const btnReopen = document.getElementById('btn-reopen-insc');
        if (btnReopen) {
            btnReopen.addEventListener('click', async () => {
                const { error } = await this.supabase.from('rachas').update({ status: 'open', inscriptions_closed_at: null }).eq('id', this.currentRacha.id);
                if (error) return this.showToast(error.message, 'error');
                this.showToast('Inscrições reabertas');
                await this.loadRachaData();
                this.render();
            });
        }

        // Finalizar racha
        const btnFin = document.getElementById('btn-finalize');
        if (btnFin) btnFin.addEventListener('click', () => this.navigate('finalize'));

        const btnConfirmFin = document.getElementById('btn-confirm-finalize');
        if (btnConfirmFin) {
            btnConfirmFin.addEventListener('click', async () => {
                if (!confirm('Finalizar o racha? Isso fecha tudo e atualiza os rankings.')) return;

                const updates = [];
                const r = this.currentRacha;

                // Coleta dados da tela
                document.querySelectorAll('[data-presence-id]').forEach(el => {
                    const id = el.dataset.presenceId;
                    const present = el.querySelector('.present.present') !== null;
                    const absent = el.querySelector('.absent.absent') !== null;
                    const presence = present ? 'present' : absent ? 'absent' : 'present'; // default present (decisão 9A)
                    updates.push({ id, presence });
                });

                document.querySelectorAll('[data-goals-id]').forEach(el => {
                    const id = el.dataset.goalsId;
                    const goals = parseInt(el.querySelector('.goals-value').textContent) || 0;
                    const u = updates.find(x => x.id === id);
                    if (u) u.goals = goals;
                    else updates.push({ id, goals });
                });

                if (r.payment_timing === 'after') {
                    document.querySelectorAll('[data-paid-id]').forEach(el => {
                        const id = el.dataset.paidId;
                        const paid = el.checked;
                        const u = updates.find(x => x.id === id);
                        if (u) u.paid_after = paid;
                        else updates.push({ id, paid_after: paid });
                    });

                    // Calcula valor por pessoa no pagamento depois
                    const activeParts = this.participations.filter(p => p.status !== 'removed');
                    const confirmedCount = activeParts.length;
                    const pricePerPerson = confirmedCount > 0 ? Math.ceil(r.field_cost_cents / confirmedCount) : 0;

                    for (const u of updates) {
                        u.amount_charged_cents = pricePerPerson;
                    }
                }

                // Atualiza participações
                for (const u of updates) {
                    await this.supabase.from('participations').update(u).eq('id', u.id);
                }

                // Finaliza racha
                const { error } = await this.supabase.from('rachas').update({ status: 'finished' }).eq('id', r.id);
                if (error) return this.showToast(error.message, 'error');

                this.showToast('Racha finalizado! Rankings atualizados.');
                this.stopRealtime();
                this.currentRacha = null;
                this.participations = [];
                this.navigate('home');
            });
        }

        // Presence toggles
        document.querySelectorAll('.presence-toggle').forEach(el => {
            el.querySelectorAll('.presence-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    el.querySelectorAll('.presence-btn').forEach(b => {
                        b.classList.remove('present', 'absent');
                    });
                    if (btn.dataset.value === 'present') btn.classList.add('present');
                    else btn.classList.add('absent');
                });
            });
        });

        // Goals buttons
        document.querySelectorAll('.goals-input').forEach(el => {
            el.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const valEl = el.querySelector('.goals-value');
                    let val = parseInt(valEl.textContent) || 0;
                    val += parseInt(btn.dataset.delta);
                    if (val < 0) val = 0;
                    valEl.textContent = val;
                });
            });
        });

        // Transferir
        const btnTransfer = document.getElementById('btn-transfer');
        if (btnTransfer) btnTransfer.addEventListener('click', () => this.navigate('transfer'));

        document.querySelectorAll('[data-transfer-id]').forEach(el => {
            el.addEventListener('click', async () => {
                const newOrgId = el.dataset.transferId;
                const newOrgName = el.querySelector('.participant-name').textContent;
                if (!confirm(`Transferir organização para ${newOrgName}?`)) return;

                const { error: err1 } = await this.supabase.from('organizer_transfers').insert({
                    racha_id: this.currentRacha.id,
                    from_player_id: this.user.id,
                    to_player_id: newOrgId
                });
                if (err1) return this.showToast(err1.message, 'error');

                const { error: err2 } = await this.supabase.from('rachas')
                    .update({ organizer_id: newOrgId })
                    .eq('id', this.currentRacha.id);
                if (err2) return this.showToast(err2.message, 'error');

                this.showToast('Organização transferida!');
                await this.loadRachaData();
                this.navigate('home');
            });
        });

        // Remover participante
        document.querySelectorAll('[data-action="remove"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const part = this.participations.find(p => p.id === id);
                if (!part) return;
                if (!confirm(`Remover ${part.player.display_name} do racha?`)) return;

                const updates = {
                    status: 'removed',
                    removed_at: new Date().toISOString(),
                    removed_by: this.user.id
                };

                // Se já pagou, marca valor a devolver
                if (part.status === 'confirmed' && part.amount_charged_cents > 0) {
                    updates.refund_owed_cents = part.amount_charged_cents;
                }

                const { error } = await this.supabase.from('participations').update(updates).eq('id', id);
                if (error) return this.showToast(error.message, 'error');
                this.showToast('Participante removido');
                await this.loadRachaData();
                this.render();
            });
        });

        // Ver comprovante
        document.querySelectorAll('[data-action="view-receipt"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const receipt = this.receipts.find(r => r.id === btn.dataset.id);
                if (!receipt) return;
                const { data } = await this.supabase.storage.from('receipts').createSignedUrl(receipt.file_path, 300);
                if (data?.signedUrl) window.open(data.signedUrl, '_blank');
            });
        });

        // Profile
        const btnSaveProfile = document.getElementById('btn-save-profile');
        if (btnSaveProfile) {
            btnSaveProfile.addEventListener('click', async () => {
                const name = document.getElementById('profile-name').value.trim();
                if (!name) return;
                const { error } = await this.supabase.from('profiles')
                    .update({ display_name: name })
                    .eq('id', this.user.id);
                if (error) return this.showToast(error.message, 'error');
                this.profile.display_name = name;
                this.showToast('Nome atualizado!');
                this.render();
            });
        }

        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', async () => {
                await this.supabase.auth.signOut();
                this.showToast('Até logo!');
            });
        }

        // Ranking tabs
        document.querySelectorAll('#ranking-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#ranking-tabs .tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadRankingData(btn.dataset.tab);
            });
        });

        if (this.currentScreen === 'rankings') {
            this.loadRankingData('gols');
        }
    }

    attachNavListeners() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const screen = btn.dataset.nav;
                if (screen === 'home') {
                    this.loadRachaData().then(() => this.navigate('home'));
                } else {
                    this.navigate(screen);
                }
            });
        });
    }

    async loadRankingData(type) {
        const container = document.getElementById('ranking-content');
        if (!container) return;

        let data, error;
        if (type === 'gols') {
            ({ data, error } = await this.supabase.from('ranking_gols').select('*'));
        } else if (type === 'presenca') {
            ({ data, error } = await this.supabase.from('ranking_presenca').select('*'));
        } else {
            ({ data, error } = await this.supabase.from('ranking_furoes').select('*'));
        }

        if (error || !data || data.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nenhum dado ainda.</p></div>';
            return;
        }

        let html = '<div class="ranking-list">';
        data.forEach((item, idx) => {
            const posClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : 'normal';
            const posLabel = idx < 3 ? ['🥇','🥈','🥉'][idx] : (idx + 1);
            let stats = '', value = '';

            if (type === 'gols') {
                value = `${item.total_gols} gols`;
                stats = `${item.total_rachas_confirmado} rachas • ${item.media_gols} gol/racha`;
            } else if (type === 'presenca') {
                value = `${item.total_presencas} presenças`;
                stats = `${item.total_confirmados} confirmados`;
            } else {
                value = `${item.total_furadas} furadas`;
                stats = `${item.total_rachas} rachas • ${item.taxa_furadas}%`;
            }

            html += `
            <div class="ranking-item">
                <div class="ranking-position ${posClass}">${posLabel}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${this.escapeHtml(item.display_name)}</div>
                    <div class="ranking-stats">${stats}</div>
                </div>
                <div class="ranking-value">${value}</div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    }
}

// Inicializa
const app = new App();
app.init();
