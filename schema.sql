-- ============================================================
-- SISTEMA DE RACHAS - SCHEMA SUPABASE COMPLETO
-- ============================================================

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: profiles (jogadores)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'Perfil dos jogadores, vinculado ao auth.users do Supabase';

-- ============================================================
-- TABELA: rachas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rachas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organizer_id UUID NOT NULL REFERENCES public.profiles(id),
    match_date DATE NOT NULL,
    match_time TIME NOT NULL,
    location TEXT NOT NULL,
    field_cost_cents INTEGER NOT NULL CHECK (field_cost_cents >= 0),
    player_target INTEGER NOT NULL CHECK (player_target >= 1),
    payment_timing TEXT NOT NULL CHECK (payment_timing IN ('before', 'after')),
    pix_key TEXT,
    payment_info TEXT,
    notes TEXT,
    price_per_person_cents INTEGER CHECK (price_per_person_cents >= 0),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'finished')),
    inscriptions_closed_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.rachas IS 'Rachas de futebol amador';

CREATE INDEX IF NOT EXISTS idx_rachas_status ON public.rachas(status);
CREATE INDEX IF NOT EXISTS idx_rachas_organizer ON public.rachas(organizer_id);

-- ============================================================
-- TABELA: participations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.participations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    racha_id UUID NOT NULL REFERENCES public.rachas(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES public.profiles(id),
    status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'confirmed', 'furou', 'removed')),
    presence TEXT CHECK (presence IN ('present', 'absent')),
    goals INTEGER NOT NULL DEFAULT 0 CHECK (goals >= 0),
    amount_charged_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_charged_cents >= 0),
    refund_owed_cents INTEGER NOT NULL DEFAULT 0 CHECK (refund_owed_cents >= 0),
    joined_at TIMESTAMPTZ DEFAULT now(),
    confirmed_at TIMESTAMPTZ,
    furou_at TIMESTAMPTZ,
    removed_at TIMESTAMPTZ,
    removed_by UUID REFERENCES public.profiles(id),
    paid_after BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(racha_id, player_id)
);

COMMENT ON TABLE public.participations IS 'Participações dos jogadores nos rachas';

CREATE INDEX IF NOT EXISTS idx_participations_racha ON public.participations(racha_id);
CREATE INDEX IF NOT EXISTS idx_participations_player ON public.participations(player_id);
CREATE INDEX IF NOT EXISTS idx_participations_status ON public.participations(status);

-- ============================================================
-- TABELA: receipts (comprovantes)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participation_id UUID NOT NULL UNIQUE REFERENCES public.participations(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.receipts IS 'Comprovantes de pagamento (privados)';

-- ============================================================
-- TABELA: organizer_transfers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.organizer_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    racha_id UUID NOT NULL REFERENCES public.rachas(id) ON DELETE CASCADE,
    from_player_id UUID NOT NULL REFERENCES public.profiles(id),
    to_player_id UUID NOT NULL REFERENCES public.profiles(id),
    transferred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfers_racha ON public.organizer_transfers(racha_id);

-- ============================================================
-- FUNÇÕES AUXILIARES
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS tr_rachas_updated_at ON public.rachas;
CREATE TRIGGER tr_rachas_updated_at
    BEFORE UPDATE ON public.rachas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS tr_participations_updated_at ON public.participations;
CREATE TRIGGER tr_participations_updated_at
    BEFORE UPDATE ON public.participations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Função: impedir mais de um racha ativo
CREATE OR REPLACE FUNCTION public.check_single_active_racha()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('open', 'closed') THEN
        IF EXISTS (
            SELECT 1 FROM public.rachas
            WHERE status IN ('open', 'closed')
            AND id != NEW.id
        ) THEN
            RAISE EXCEPTION 'Ja existe um racha ativo. Apenas um racha ativo por vez.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_single_active_racha ON public.rachas;
CREATE TRIGGER tr_single_active_racha
    BEFORE INSERT OR UPDATE ON public.rachas
    FOR EACH ROW EXECUTE FUNCTION public.check_single_active_racha();

-- Função: ao finalizar racha, fechar inscrições
CREATE OR REPLACE FUNCTION public.auto_close_on_finish()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
        NEW.inscriptions_closed_at = COALESCE(NEW.inscriptions_closed_at, now());
        NEW.finished_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_auto_close_finish ON public.rachas;
CREATE TRIGGER tr_auto_close_finish
    BEFORE UPDATE ON public.rachas
    FOR EACH ROW EXECUTE FUNCTION public.auto_close_on_finish();

-- Função: ao encerrar inscrições, marcar furões
CREATE OR REPLACE FUNCTION public.mark_furoes_on_close()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'closed' AND OLD.status = 'open' THEN
        NEW.inscriptions_closed_at = now();

        UPDATE public.participations
        SET status = 'furou', furou_at = now()
        WHERE racha_id = NEW.id
        AND status = 'awaiting_payment'
        AND NEW.payment_timing = 'before';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_mark_furoes ON public.rachas;
CREATE TRIGGER tr_mark_furoes
    BEFORE UPDATE ON public.rachas
    FOR EACH ROW EXECUTE FUNCTION public.mark_furoes_on_close();

-- Função: ao enviar comprovante, confirmar automaticamente
CREATE OR REPLACE FUNCTION public.confirm_on_receipt()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.participations
    SET status = 'confirmed', confirmed_at = now(), updated_at = now()
    WHERE id = NEW.participation_id
    AND status IN ('awaiting_payment', 'furou');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_confirm_on_receipt ON public.receipts;
CREATE TRIGGER tr_confirm_on_receipt
    AFTER INSERT ON public.receipts
    FOR EACH ROW EXECUTE FUNCTION public.confirm_on_receipt();

-- Função: criar perfil automaticamente após signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'username',
        COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_auth_user_created ON auth.users;
CREATE TRIGGER tr_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

ALTER TABLE public.rachas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rachas_select_all"
    ON public.rachas FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "rachas_insert_any"
    ON public.rachas FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "rachas_update_organizer"
    ON public.rachas FOR UPDATE
    TO authenticated
    USING (organizer_id = auth.uid())
    WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "rachas_delete_organizer"
    ON public.rachas FOR DELETE
    TO authenticated
    USING (organizer_id = auth.uid());

ALTER TABLE public.participations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participations_select_all"
    ON public.participations FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "participations_insert_own"
    ON public.participations FOR INSERT
    TO authenticated
    WITH CHECK (player_id = auth.uid());

CREATE POLICY "participations_update_own_or_organizer"
    ON public.participations FOR UPDATE
    TO authenticated
    USING (
        player_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM public.rachas r 
            WHERE r.id = participations.racha_id 
            AND r.organizer_id = auth.uid()
        )
    )
    WITH CHECK (
        player_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM public.rachas r 
            WHERE r.id = participations.racha_id 
            AND r.organizer_id = auth.uid()
        )
    );

CREATE POLICY "participations_delete_organizer"
    ON public.participations FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rachas r 
            WHERE r.id = participations.racha_id 
            AND r.organizer_id = auth.uid()
        )
    );

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts_select_organizer"
    ON public.receipts FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.participations p
            JOIN public.rachas r ON r.id = p.racha_id
            WHERE p.id = receipts.participation_id
            AND r.organizer_id = auth.uid()
        )
    );

CREATE POLICY "receipts_insert_own"
    ON public.receipts FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.participations p
            WHERE p.id = receipts.participation_id
            AND p.player_id = auth.uid()
        )
    );

CREATE POLICY "receipts_delete_organizer"
    ON public.receipts FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.participations p
            JOIN public.rachas r ON r.id = p.racha_id
            WHERE p.id = receipts.participation_id
            AND r.organizer_id = auth.uid()
        )
    );

ALTER TABLE public.organizer_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transfers_select_all"
    ON public.organizer_transfers FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "transfers_insert_organizer"
    ON public.organizer_transfers FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.rachas r
            WHERE r.id = organizer_transfers.racha_id
            AND r.organizer_id = auth.uid()
        )
    );

-- ============================================================
-- STORAGE: bucket para comprovantes
-- ============================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "receipts_storage_select_organizer"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'receipts'
        AND EXISTS (
            SELECT 1 FROM public.receipts rec
            JOIN public.participations p ON p.id = rec.participation_id
            JOIN public.rachas r ON r.id = p.racha_id
            WHERE rec.file_path = storage.objects.name
            AND r.organizer_id = auth.uid()
        )
    );

CREATE POLICY "receipts_storage_insert_own"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'receipts'
    );

CREATE POLICY "receipts_storage_delete_organizer"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'receipts'
        AND EXISTS (
            SELECT 1 FROM public.receipts rec
            JOIN public.participations p ON p.id = rec.participation_id
            JOIN public.rachas r ON r.id = p.racha_id
            WHERE rec.file_path = storage.objects.name
            AND r.organizer_id = auth.uid()
        )
    );

-- ============================================================
-- REALTIME: habilitar para tabelas
-- ============================================================
ALTER TABLE public.rachas REPLICA IDENTITY FULL;
ALTER TABLE public.participations REPLICA IDENTITY FULL;
ALTER TABLE public.receipts REPLICA IDENTITY FULL;

-- ============================================================
-- VIEWS ÚTEIS
-- ============================================================

CREATE OR REPLACE VIEW public.ranking_gols AS
SELECT 
    pr.id,
    pr.display_name,
    COALESCE(SUM(p.goals), 0) AS total_gols,
    COUNT(p.id) FILTER (WHERE p.presence = 'present') AS total_rachas_presente,
    COUNT(p.id) AS total_rachas_confirmado,
    CASE 
        WHEN COUNT(p.id) > 0 THEN ROUND(COALESCE(SUM(p.goals), 0)::numeric / COUNT(p.id), 2)
        ELSE 0
    END AS media_gols
FROM public.profiles pr
LEFT JOIN public.participations p ON p.player_id = pr.id
LEFT JOIN public.rachas r ON r.id = p.racha_id
WHERE r.status = 'finished' OR r.id IS NULL
GROUP BY pr.id, pr.display_name
HAVING COUNT(p.id) > 0
ORDER BY total_gols DESC, total_rachas_confirmado ASC;

CREATE OR REPLACE VIEW public.ranking_presenca AS
SELECT 
    pr.id,
    pr.display_name,
    COUNT(p.id) FILTER (WHERE p.presence = 'present') AS total_presencas,
    COUNT(p.id) AS total_confirmados
FROM public.profiles pr
LEFT JOIN public.participations p ON p.player_id = pr.id
LEFT JOIN public.rachas r ON r.id = p.racha_id
WHERE r.status = 'finished' OR r.id IS NULL
GROUP BY pr.id, pr.display_name
HAVING COUNT(p.id) > 0
ORDER BY total_presencas DESC, total_confirmados ASC;

CREATE OR REPLACE VIEW public.ranking_furoes AS
SELECT 
    pr.id,
    pr.display_name,
    COUNT(p.id) FILTER (WHERE p.status = 'furou') AS total_furadas,
    COUNT(p.id) AS total_rachas,
    CASE 
        WHEN COUNT(p.id) > 0 THEN ROUND(COUNT(p.id) FILTER (WHERE p.status = 'furou')::numeric / COUNT(p.id) * 100, 1)
        ELSE 0
    END AS taxa_furadas
FROM public.profiles pr
LEFT JOIN public.participations p ON p.player_id = pr.id
LEFT JOIN public.rachas r ON r.id = p.racha_id
WHERE r.status = 'finished' OR r.id IS NULL
GROUP BY pr.id, pr.display_name
HAVING COUNT(p.id) FILTER (WHERE p.status = 'furou') > 0
ORDER BY total_furadas DESC, taxa_furadas DESC;
