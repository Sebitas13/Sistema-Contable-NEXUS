/**
 * FinancialStatementEngine.js (MOTOR PURO UNIVERSAL v4.0)
 * "PERFECT HARMONIZATION"
 * 1. Synchronized with Worksheet.jsx (Strict Classification).
 * 2. 13-Step Strict Waterfall Logic.
 * 3. Sub-grouping (Admin/Sales/Financial) & Non-Taxable Income (Dividends).
 */
import { generarEstadoResultados } from './IncomeStatementEngine';
import { AccountPlanProfile } from './AccountPlanProfile';
export class FinancialStatementEngine {
    constructor(accounts) {
        this.accounts = Array.isArray(accounts) ? accounts : [];
        console.log('📊 FinancialStatementEngine: Cuentas recibidas:', this.accounts.length);

        this.mapa = this.construirMapa();
        console.log('📊 FinancialStatementEngine: Mapa construido con', Object.keys(this.mapa).length, 'cuentas');

        // NUEVO: Análisis inteligente de jerarquía (con manejo de errores)
        try {
            // Verificar que los datos tienen el formato correcto para AccountPlanProfile
            console.log('📊 DATOS PARA ANÁLISIS - Primeros 5 registros:');
            this.accounts.slice(0, 5).forEach((acc, i) => {
                console.log(`  ${i + 1}. code: ${acc.code}, name: ${acc.name}, parent_code: ${acc.parent_code}`);
            });

            this.analysis = AccountPlanProfile.analyze(this.accounts);
            console.log('📊 FinancialStatementEngine: Análisis inteligente completado');
            console.log('📊 Análisis resultante:', {
                separator: this.analysis.separator,
                levelsCount: this.analysis.levelsCount,
                mask: this.analysis.mask,
                hasGetParent: !!this.analysis.getParent,
                samples: this.analysis.samples?.slice(0, 3)
            });

            // Probar algunas detecciones de padre
            const testCodes = this.accounts.slice(0, 5).map(acc => acc.code);
            console.log('📊 PRUEBA de detección de padres:');
            testCodes.forEach(code => {
                const detected = this.analysis.getParent ? this.analysis.getParent(code) : null;
                console.log(`  ${code} -> padre detectado: ${detected}`);
            });

        } catch (error) {
            console.warn('⚠️ FinancialStatementEngine: Error en análisis inteligente, usando fallback:', error.message);
            console.error('Stack trace:', error.stack);
            this.analysis = { getParent: () => null }; // Fallback seguro
        }

        // 1. Vincular Reguladoras a sus Activos
        this.asociarReguladorasInteligente();

        // 2. Construir árbol general (para Balance)
        this.raices = this.identificarRaices();
        console.log('📊 FinancialStatementEngine: Raíces identificadas:', this.raices.length);

        // 3. Desglose Visual Activos
        this.desglosarCuentasConReguladoras();

        this.utilidadInyectada = false;

        // Pre-calculate totals
        this.calcularTotales();
    }

    // ========== CONSTRUCCIÓN BASE ==========

    construirMapa() {
        const mapa = {};
        this.accounts.forEach(cuenta => {
            const debit = Number(cuenta.total_debit || 0);
            const credit = Number(cuenta.total_credit || 0);
            const saldoSigned = debit - credit;

            // LÓGICA DE HOJA DE TRABAJO (Crucial)
            const classification = this.classifyAccount(cuenta, debit, credit);

            mapa[cuenta.code] = {
                ...cuenta,
                hijos: [],
                total: 0,
                saldo_matematico: saldoSigned,
                classification: classification,
                esReguladora: classification.isReguladora,
                original_parent: cuenta.parent_code
            };
        });
        return mapa;
    }

    // -> PORTADO DE Worksheet.jsx (CON EXACTITUD)
    classifyAccount(acc, debit, credit) {
        const rawType = (acc.type || '').toString();
        const type = rawType.trim();
        const group = (acc.group || acc.group_name || acc.category || acc.account_group || '').toString().trim();
        const code = (acc.code || '').toString().trim();

        const adjustedBalance = debit - credit;

        const t = (type || group).toLowerCase();
        const name = (acc.name || '').toString();
        const lowerName = name.toLowerCase();

        const isReguladora = /regul/i.test(t) || /depreciacion acumulada|amortizacion acumulada|deterioro acumulado|prevision|provision/i.test(lowerName);
        const isOrden = /orden/i.test(t);
        const isResultado = /resulta/i.test(t);

        // Fallbacks por código
        // Classification Priority: Default Code Prefix -> Keyword Match -> Metadata Fallback
        const isActivoType = /^1/.test(code) || /activo/i.test(t) || type.toLowerCase() === 'activo';
        const isPasivoType = /^2/.test(code) || /pasivo/i.test(t) || type.toLowerCase() === 'pasivo';
        const isPatrimonioType = /^3/.test(code) || /patrimonio/i.test(t) || type.toLowerCase() === 'patrimonio';
        const isIngresoType = /^4/.test(code) || /ingreso/i.test(t) || type.toLowerCase() === 'ingreso';
        const isEgresoType = /^5/.test(code) || /costo/i.test(t) || type.toLowerCase() === 'costo';
        const isGastoType = /^6/.test(code) || /gasto|egreso/i.test(t) || type.toLowerCase() === 'gasto' || type.toLowerCase() === 'egreso';

        const isResultadosAcumulados = /resultad.*acumul/i.test(lowerName);

        // Variable patterns (Inflation, Exchange Diff) - SYNCED WITH IncomeStatementEngine
        const variablePatterns = [
            'diferencia de cambio', 'diferencias de cambio', 'tipo de cambio',
            'exposicion a la inflacion', 'exposición a la inflación',
            'ajuste por inflacion', 'ajuste por inflación', 'ajuste por inflacion y tenencia de bienes',
            'tenencia de bienes', 'reme', 'resultado monetario', 'resultados por exposicion a la inflacion',
            'mantenimiento de valor', 'mantenimiento del valor',
            'perdidas y ganancias', 'pérdidas y ganancias',
            'resultados de la gestion', 'resultados de la gestión',
            'resultado del ejercicio', 'resultado neto',
            'utilidad o perdida', 'utilidad o pérdida', 'ganancia o perdida', 'ganancia o pérdida',
            'resultado extraordinario', 'resultados extraordinarios', 'otros resultados', 'resultado integral',
            'diferencia por redondeo', 'ajuste de capital'
        ];
        const isVariable = variablePatterns.some(p => lowerName.includes(p));

        let finalGasto = false;
        let finalIngreso = false;

        if (isVariable) {
            // Sign-based classification
            if (adjustedBalance >= 0) {
                finalGasto = true;  // Deudor = Gasto
            } else {
                finalIngreso = true;  // Acreedor = Ingreso
            }
        } else {
            // Static classification
            const resultadoAsGasto = isResultado && adjustedBalance >= 0;
            const resultadoAsIngreso = isResultado && adjustedBalance < 0;

            // Standardizing keywords with IncomeStatementEngine
            const isGastoKeyword = /gasto|egreso|perdida|pérdida/i.test(lowerName);
            const isIngresoKeyword = /ingreso|venta|ganancia/i.test(lowerName);
            const isEgresoKeyword = /costo/i.test(lowerName);

            finalGasto = isGastoType || isGastoKeyword || isEgresoKeyword || isEgresoType || resultadoAsGasto;
            finalIngreso = isIngresoType || isIngresoKeyword || resultadoAsIngreso;
        }

        // Strict Exclusions
        if (isReguladora) { finalGasto = false; finalIngreso = false; }
        if ((isActivoType || isPasivoType || isPatrimonioType) && !isVariable && !isResultado) {
            finalGasto = false; finalIngreso = false;
        }

        return {
            isReguladora,
            isOrden,
            isResultado,
            isGasto: finalGasto,
            isIngreso: finalIngreso,
            isActivo: isActivoType,
            isPasivo: isPasivoType,
            isPatrimonio: isPatrimonioType,
            isResultadosAcumulados,
            isVariable
        };
    }

    asociarReguladorasInteligente() {
        const nodos = Object.values(this.mapa);
        const posiblesMadres = nodos.filter(n => {
            if (n.esReguladora) return false;
            return String(n.code).startsWith("1");
        });

        nodos.forEach(nodo => {
            if (!nodo.esReguladora) return;
            const nombreLimpio = this.limpiarNombreReguladora(nodo.name);
            if (!nombreLimpio || nombreLimpio.length < 3) return;

            // Prioridad exacta -> Contiene -> Inverso
            let madre = posiblesMadres.find(m => m.name.toLowerCase().trim() === nombreLimpio.toLowerCase().trim());
            if (!madre) madre = posiblesMadres.find(m => m.name.toLowerCase().includes(nombreLimpio.toLowerCase()));
            if (!madre) madre = posiblesMadres.find(m => nombreLimpio.toLowerCase().includes(m.name.toLowerCase()));

            if (madre) nodo.parent_code = madre.code;
        });
    }

    identificarRaices() {
        const raices = [];
        const processados = new Set();

        console.log('🔍 identificarRaices: Iniciando construcción de jerarquía');
        console.log('🔍 Total de nodos a procesar:', Object.keys(this.mapa).length);

        Object.values(this.mapa).forEach(nodo => {
            // NUEVO: Intentar obtener parent_code de análisis inteligente, con fallback al dato original
            const detectedParent = this.analysis && this.analysis.getParent ? this.analysis.getParent(nodo.code) : null;
            const originalParent = nodo.parent_code;
            const codigoPadre = detectedParent || nodo.parent_code;

            console.log(`🔍 Nodo ${nodo.code} (${nodo.name}):`);
            console.log(`   - parent_code original: ${originalParent}`);
            console.log(`   - parent_code detectado: ${detectedParent}`);
            console.log(`   - parent_code final usado: ${codigoPadre}`);

            if (!codigoPadre) {
                console.log(`   ✅ Agregado como RAÍZ (sin padre)`);
                raices.push(nodo);
                return;
            }

            const padre = this.mapa[codigoPadre];
            if (padre) {
                if (!padre.hijos) padre.hijos = [];
                padre.hijos.push(nodo);
                processados.add(nodo.code);
                console.log(`   ✅ Vinculado a padre ${codigoPadre} (${padre.name})`);
            } else {
                console.log(`   ⚠️ Padre ${codigoPadre} no encontrado, agregado como RAÍZ`);
                raices.push(nodo);
            }
        });

        console.log('🔍 Raíces finales:', raices.map(r => `${r.code} (${r.name})`));
        console.log('🔍 Total raíces:', raices.length);

        return raices;
    }

    desglosarCuentasConReguladoras() {
        Object.values(this.mapa).forEach(nodo => {
            if (nodo.hijos && nodo.hijos.length > 0 && Math.abs(nodo.saldo_matematico) > 0.01) {
                const hijoBruto = {
                    ...nodo,
                    id: nodo.id + '_bruto',
                    code: '',
                    name: nodo.name + ' (Valor Origen)',
                    saldo_matematico: nodo.saldo_matematico,
                    total: nodo.saldo_matematico,
                    hijos: [],
                    esSintetico: true,
                    esBruto: true
                };
                nodo.saldo_matematico = 0;
                nodo.hijos.unshift(hijoBruto);
            }
        });
    }

    limpiarNombreReguladora(nombre) {
        if (!nombre) return "";
        let n = nombre.toLowerCase();
        n = n.replace(/depreciacion acumulada|depreciación acumulada|amortizacion acumulada|amortización acumulada|deterioro acumulado|prevision para|previsión para|provision para|provisión para|dep\. acum\.|amort\. acum\./g, "");
        n = n.trim();
        if (n.startsWith("de ")) n = n.substring(3);
        if (n.startsWith("del ")) n = n.substring(4);
        return n.trim();
    }

    calcularTotales() {
        this.raices.forEach(r => this.calcularTotalRecursivo(r));
        this.raices.sort((a, b) => (a.code || '').toString().localeCompare((b.code || '').toString()));
    }

    calcularTotalRecursivo(nodo) {
        let sumaHijos = 0;
        if (nodo.hijos && nodo.hijos.length > 0) {
            nodo.hijos.sort((a, b) => (a.code || '').toString().localeCompare((b.code || '').toString()));
            nodo.hijos.forEach(h => sumaHijos += this.calcularTotalRecursivo(h));
        }
        nodo.total = (nodo.saldo_matematico || 0) + sumaHijos;
        return nodo.total;
    }

    filtrarCuentasEnCero(nodos) {
        console.log('📊 filtrarCuentasEnCero: Entrando con', nodos.length, 'nodos');

        return nodos.map(n => {
            const nuevo = { ...n };
            if (nuevo.hijos && nuevo.hijos.length > 0) nuevo.hijos = this.filtrarCuentasEnCero(nuevo.hijos);
            return nuevo;
        }).filter(n => {
            if (n.esSintetico) {
                console.log('📊   Manteniendo sintético:', n.name);
                return true;
            }
            const saldo = Math.abs(n.total) > 0.001;
            const hijos = n.hijos && n.hijos.length > 0;
            const hasChildrenWithBalance = n.hijos && n.hijos.some(h => Math.abs(h.total) > 0.001);

            const mantiene = saldo || hijos || hasChildrenWithBalance;
            if (mantiene) {
                console.log('📊   Manteniendo:', n.name, '- saldo:', saldo, '- hijos:', hijos, '- hasChildrenWithBalance:', hasChildrenWithBalance);
            } else {
                console.log('📊   Filtrando:', n.name, '- total:', n.total);
            }

            return mantiene;
        });
    }

    // ========== MOTOR ESTADO RESULTADOS v4.0 (PERFECTO) ==========

    buildSectionTree(predicate, multiplier = 1) {
        const allAccounts = Object.values(this.mapa);
        const filtered = allAccounts.filter(predicate);

        const cloneMap = {};

        filtered.forEach(node => {
            const originalTotal = node.total;
            const waterfallVal = originalTotal * multiplier;

            cloneMap[node.code] = {
                ...node,
                hijos: [],
                total: waterfallVal,
                saldo_matematico: node.saldo_matematico * multiplier
            };
        });

        const roots = [];

        filtered.forEach(node => {
            const current = cloneMap[node.code];
            // Usar la misma lógica de jerarquía inteligente que identificarRaices
            const detectedParent = this.analysis && this.analysis.getParent ? this.analysis.getParent(node.code) : null;
            const parentCode = detectedParent || node.parent_code;
            const parent = cloneMap[parentCode];

            if (parent && cloneMap[parentCode]) {
                parent.hijos.push(current);
            } else {
                roots.push(current);
            }
        });

        const recalculate = (n) => {
            let sumHijos = 0;
            if (n.hijos.length > 0) {
                n.hijos.forEach(h => sumHijos += recalculate(h));
            }
            // Use own balance + children sum
            n.total = n.saldo_matematico + sumHijos;
            return n.total;
        };

        roots.forEach(r => recalculate(r));
        // Sort
        const sortNodes = (list) => {
            list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
            list.forEach(item => {
                if (item.hijos.length > 0) sortNodes(item.hijos);
            });
        };
        sortNodes(roots);

        return this.filtrarCuentasEnCero(roots);
    }



    async generarBalanceGeneral() {
        console.log('📊 generarBalanceGeneral: INICIANDO');
        console.log('📊 utilidadLiquidaExterna:', this.utilidadLiquidaExterna);
        console.log('📊 iuePorPagar:', this.iuePorPagar);
        console.log('📊 reservaLegalMonto:', this.reservaLegalMonto);

        const er = generarEstadoResultados(Object.values(this.mapa));
        console.log('📊 ER totales.utilidadLiquida:', er.totales.utilidadLiquida);

        const resultadoEjercicio = this.utilidadLiquidaExterna !== undefined ? this.utilidadLiquidaExterna : er.totales.utilidadLiquida;
        const iueMonto = this.iuePorPagar !== undefined ? this.iuePorPagar : er.totales.iue;
        const reservaMonto = this.reservaLegalMonto !== undefined ? this.reservaLegalMonto : er.totales.reservaLegal;

        this.inyectarUtilidad(resultadoEjercicio);
        if (iueMonto > 0) this.inyectarPasivoImpuesto(iueMonto);
        if (reservaMonto > 0) this.inyectarReservaLegal(reservaMonto);
        this.calcularTotales();

        const filtrarBalance = (tipoRequerido) => (nodo) => {
            const cls = nodo.classification;
            const tr = tipoRequerido.toLowerCase();
            if (tr === 'activo') return cls.isActivo || cls.isReguladora || nodo.esBruto;
            if (tr === 'pasivo') return cls.isPasivo;
            if (tr === 'patrimonio') return cls.isPatrimonio;
            return false;
        };

        let activos = this.raices.filter(filtrarBalance('Activo'));
        let pasivos = this.raices.filter(filtrarBalance('Pasivo'));
        let patrimonio = this.raices.filter(filtrarBalance('Patrimonio'));

        activos = this.filtrarCuentasEnCero(activos);
        pasivos = this.filtrarCuentasEnCero(pasivos);
        patrimonio = this.filtrarCuentasEnCero(patrimonio);

        const totalActivo = this.calcularTotalGrupo(activos);
        const totalPasivo = this.calcularTotalGrupo(pasivos);
        const totalPatrimonio = this.calcularTotalGrupo(patrimonio);

        const balanceCheck = totalActivo + totalPasivo + totalPatrimonio;

        return {
            activos,
            pasivos,
            patrimonio,
            totales: {
                activo: totalActivo,
                pasivo: Math.abs(totalPasivo),
                patrimonio: Math.abs(totalPatrimonio)
            },
            ecuacionCuadra: Math.abs(balanceCheck) < 1.0,
            diferencia: Math.abs(balanceCheck),
            utilidadNeta: er.totales.utilidadNeta
        };
    }

    inyectarUtilidad(valorSigned) {
        console.log('📊 inyectarUtilidad: valorSigned =', valorSigned);
        // En el Engine: Crédito es negativo. Utilidad (Ganancia) aumenta Patrimonio (Crédito).
        // Si valorSigned viene positivo (Ganancia del ER), lo volvemos negativo.
        const valorParaBalance = valorSigned * -1;

        const nodoUtilidad = {
            id: 'utilidad-ejercicio-auto', // ID único
            code: '',
            name: valorSigned >= 0 ? 'UTILIDAD LÍQUIDA DEL EJERCICIO' : 'PÉRDIDA DEL EJERCICIO',
            type: 'Patrimonio',
            hijos: [],
            saldo_matematico: valorParaBalance,
            total: valorParaBalance,
            esSintetico: true,
            esBruto: true, // Truco: Marcamos como bruto para evitar filtrados agresivos
            classification: { isPatrimonio: true, isResultado: true }
        };

        // ESTRATEGIA DE BÚSQUEDA MEJORADA
        const raicesPatrimonio = this.raices.filter(r => r.classification.isPatrimonio);

        // 1. Intentar encontrar "Resultados Acumulados" recursivamente
        const buscarYInsertar = (nodos) => {
            for (let n of nodos) {
                // Regex más flexible
                if (/resultad.*acumul/i.test(n.name) || /acumulad/i.test(n.name)) {
                    if (!n.hijos) n.hijos = [];
                    n.hijos.push(nodoUtilidad);
                    // IMPORTANTE: Sumar al total del padre para que la jerarquía cuadre
                    this.actualizarTotalesHaciaArriba(n, valorParaBalance);
                    return true;
                }
                if (n.hijos && n.hijos.length > 0) {
                    if (buscarYInsertar(n.hijos)) return true;
                }
            }
            return false;
        };

        // Helper para recalcular totales hacia arriba (simple visual fix)
        this.actualizarTotalesHaciaArriba = (nodo, valor) => {
            nodo.total = (nodo.total || 0) + valor;
            // Nota: No podemos subir más porque no tenemos puntero al padre aquí, 
            // pero el paso this.calcularTotales() al final del main loop lo arreglará.
        };

        let insertado = buscarYInsertar(raicesPatrimonio);

        // 2. Si falla, inyectar en la raíz de Patrimonio directamente
        if (!insertado) {
            console.warn('⚠️ No se encontró Resultados Acumulados. Inyectando en raíz Patrimonio.');
            if (raicesPatrimonio.length > 0) {
                raicesPatrimonio[0].hijos.push(nodoUtilidad);
                // No sumamos al padre aquí porque calcularTotales lo hará
            } else {
                // Caso extremo: No hay patrimonio, creamos la raíz
                const rootPat = {
                    id: 'patrimonio-root-auto',
                    code: '3',
                    name: 'PATRIMONIO',
                    hijos: [nodoUtilidad],
                    total: 0,
                    classification: { isPatrimonio: true }
                };
                this.raices.push(rootPat);
            }
        }
    }

    inyectarPasivoImpuesto(monto) {
        // Buscar cuenta existente de IUE en Pasivo para sumarle el monto
        const buscarYSumar = (nodos, regex) => {
            for (const n of nodos) {
                if (regex.test(n.name.toLowerCase())) {
                    // Pasivo aumenta con crédito (negativo en este motor: debit - credit)
                    n.saldo_matematico -= monto;
                    return true;
                }
                if (n.hijos && n.hijos.length > 0) {
                    if (buscarYSumar(n.hijos, regex)) return true;
                }
            }
            return false;
        };

        const found = buscarYSumar(this.raices, /iue por pagar|impuesto a las utilidades/);

        if (!found) {
            // Si no existe, crear nodo sintético en Pasivo
            const nodoIUE = {
                id: 'iue-auto', code: '', name: 'Impuesto sobre las Utilidades por Pagar',
                type: 'Pasivo', hijos: [], saldo_matematico: -monto, total: -monto,
                esSintetico: true, classification: { isPasivo: true }
            };
            const pasivoRoot = this.raices.find(r => r.classification.isPasivo);
            if (pasivoRoot) pasivoRoot.hijos.push(nodoIUE);
            else this.raices.push(nodoIUE);
        }
    }

    inyectarReservaLegal(monto) {
        // Buscar cuenta existente de Reserva Legal en Patrimonio
        const buscarYSumar = (nodos, regex) => {
            for (const n of nodos) {
                if (regex.test(n.name.toLowerCase())) {
                    // Patrimonio aumenta con crédito (negativo)
                    n.saldo_matematico -= monto;
                    return true;
                }
                if (n.hijos && n.hijos.length > 0) {
                    if (buscarYSumar(n.hijos, regex)) return true;
                }
            }
            return false;
        };

        const found = buscarYSumar(this.raices, /reserva legal/);

        if (!found) {
            const nodoReserva = {
                id: 'reserva-auto', code: '', name: 'Reserva Legal',
                type: 'Patrimonio', hijos: [], saldo_matematico: -monto, total: -monto,
                esSintetico: true, classification: { isPatrimonio: true }
            };
            const patRoot = this.raices.find(r => r.classification.isPatrimonio);
            if (patRoot) patRoot.hijos.push(nodoReserva);
            else this.raices.push(nodoReserva);
        }
    }

    calcularTotalGrupo(nodos) {
        return nodos.reduce((acc, curr) => acc + (curr.total || 0), 0);
    }
    esCuentaReguladora(cuenta) {
        return cuenta.classification ? cuenta.classification.isReguladora : false;
    }
}

export default FinancialStatementEngine;
