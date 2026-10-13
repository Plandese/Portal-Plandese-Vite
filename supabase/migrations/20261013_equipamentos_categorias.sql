-- Novas categorias de equipamentos: equipamento / veículo ligeiro de passageiros /
-- veículo ligeiro de mercadorias / veículo pesado.
update public.equipamentos set categoria='equipamento' where categoria in ('maquina','ferramenta','outro') or categoria is null;
-- 'veiculo' (antigo) fica como ligeiro de mercadorias; ajustar à mão os de passageiros/pesados.
update public.equipamentos set categoria='veiculo_mercadorias' where categoria='veiculo';
