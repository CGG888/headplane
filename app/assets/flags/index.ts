// MARK: Flag assets
//
// The flags next to a relay region's name. One SVG per country, the 4x3
// artwork from the MIT-licensed `flag-icons` package (see LICENSE next to
// them); only the countries `~/utils/region-country` can resolve are shipped,
// so the table below is exactly the set of flags a region can render.
//
// They are imported as URLs rather than inlined, so the browser caches one file
// per country and a page with no relays pays for none of them.

import aeFlag from "./ae.svg";
import amFlag from "./am.svg";
import arFlag from "./ar.svg";
import atFlag from "./at.svg";
import auFlag from "./au.svg";
import azFlag from "./az.svg";
import beFlag from "./be.svg";
import bgFlag from "./bg.svg";
import brFlag from "./br.svg";
import caFlag from "./ca.svg";
import chFlag from "./ch.svg";
import clFlag from "./cl.svg";
import cnFlag from "./cn.svg";
import coFlag from "./co.svg";
import czFlag from "./cz.svg";
import deFlag from "./de.svg";
import dkFlag from "./dk.svg";
import eeFlag from "./ee.svg";
import esFlag from "./es.svg";
import fiFlag from "./fi.svg";
import frFlag from "./fr.svg";
import gbFlag from "./gb.svg";
import geFlag from "./ge.svg";
import hkFlag from "./hk.svg";
import huFlag from "./hu.svg";
import idFlag from "./id.svg";
import ieFlag from "./ie.svg";
import ilFlag from "./il.svg";
import inFlag from "./in.svg";
import itFlag from "./it.svg";
import jpFlag from "./jp.svg";
import keFlag from "./ke.svg";
import krFlag from "./kr.svg";
import kzFlag from "./kz.svg";
import lvFlag from "./lv.svg";
import mdFlag from "./md.svg";
import moFlag from "./mo.svg";
import mxFlag from "./mx.svg";
import myFlag from "./my.svg";
import ngFlag from "./ng.svg";
import nlFlag from "./nl.svg";
import noFlag from "./no.svg";
import nzFlag from "./nz.svg";
import omFlag from "./om.svg";
import peFlag from "./pe.svg";
import phFlag from "./ph.svg";
import plFlag from "./pl.svg";
import ptFlag from "./pt.svg";
import qaFlag from "./qa.svg";
import roFlag from "./ro.svg";
import ruFlag from "./ru.svg";
import saFlag from "./sa.svg";
import seFlag from "./se.svg";
import sgFlag from "./sg.svg";
import trFlag from "./tr.svg";
import twFlag from "./tw.svg";
import usFlag from "./us.svg";
import zaFlag from "./za.svg";

/** ISO 3166-1 alpha-2 country code -> the flag to render for it. */
export const FLAG_URLS: Record<string, string> = {
  ae: aeFlag,
  am: amFlag,
  ar: arFlag,
  at: atFlag,
  au: auFlag,
  az: azFlag,
  be: beFlag,
  bg: bgFlag,
  br: brFlag,
  ca: caFlag,
  ch: chFlag,
  cl: clFlag,
  cn: cnFlag,
  co: coFlag,
  cz: czFlag,
  de: deFlag,
  dk: dkFlag,
  ee: eeFlag,
  es: esFlag,
  fi: fiFlag,
  fr: frFlag,
  gb: gbFlag,
  ge: geFlag,
  hk: hkFlag,
  hu: huFlag,
  id: idFlag,
  ie: ieFlag,
  il: ilFlag,
  in: inFlag,
  it: itFlag,
  jp: jpFlag,
  ke: keFlag,
  kr: krFlag,
  kz: kzFlag,
  lv: lvFlag,
  md: mdFlag,
  mo: moFlag,
  mx: mxFlag,
  my: myFlag,
  ng: ngFlag,
  nl: nlFlag,
  no: noFlag,
  nz: nzFlag,
  om: omFlag,
  pe: peFlag,
  ph: phFlag,
  pl: plFlag,
  pt: ptFlag,
  qa: qaFlag,
  ro: roFlag,
  ru: ruFlag,
  sa: saFlag,
  se: seFlag,
  sg: sgFlag,
  tr: trFlag,
  tw: twFlag,
  us: usFlag,
  za: zaFlag,
};
