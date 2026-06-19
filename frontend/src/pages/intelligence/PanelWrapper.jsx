import React from "react";
import { useOutletContext } from "react-router-dom";

export default function PanelWrapper({ Component, passProdObs = false }) {
  const { wsId, prodObsEnabled, suppressProdObsNotice } = useOutletContext();
  const props = { wsId };
  if (passProdObs) {
    props.prodObservationEnabled = prodObsEnabled;
    props.suppressProdObsNotice = suppressProdObsNotice;
  }
  return <Component {...props} />;
}
