// Gemeinsame Modelldateien (model/*) übersetzen lassen: dort steht ein eigenes tr() ohne Abhängigkeit von i18n.ts,
// damit der Server sie weiter laden kann. Muss vor allen model/*-Modulen ausgewertet werden (state.ts importiert diese
// Datei zuerst, main.ts importiert state.ts zuerst), weil Kataloge und Bezeichnungen beim Laden entstehen.
import { tr } from './i18n';
import { setModelTr } from './model/text.ts';

setModelTr(tr);
