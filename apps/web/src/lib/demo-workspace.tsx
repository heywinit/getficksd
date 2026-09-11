import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { type DemoOperator, getDemoOperators } from "@/lib/backend";

const SELECTED_OPERATOR_KEY = "wattson.demo.operator";

type DemoWorkspaceContextValue = {
  operators: DemoOperator[];
  operator?: DemoOperator;
  isLoading: boolean;
  error?: string;
  selectOperator: (operatorId: string) => void;
};

const DemoWorkspaceContext = createContext<DemoWorkspaceContextValue | null>(null);

export function DemoWorkspaceProvider({ children }: { children: ReactNode }) {
  const [operators, setOperators] = useState<DemoOperator[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    getDemoOperators(controller.signal)
      .then((items) => {
        setOperators(items);
        setSelectedOperatorId(window.localStorage.getItem(SELECTED_OPERATOR_KEY) ?? items[0]?.id);
        setError(undefined);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error ? requestError.message : "Demo operators failed to load.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const operator = operators.find((item) => item.id === selectedOperatorId) ?? operators.at(0);

  const selectOperator = useCallback((operatorId: string) => {
    setSelectedOperatorId(operatorId);
    window.localStorage.setItem(SELECTED_OPERATOR_KEY, operatorId);
  }, []);

  const value = useMemo(
    () => ({ operators, operator, isLoading, error, selectOperator }),
    [error, isLoading, operator, operators, selectOperator],
  );

  return <DemoWorkspaceContext.Provider value={value}>{children}</DemoWorkspaceContext.Provider>;
}

export function useDemoWorkspace() {
  const context = useContext(DemoWorkspaceContext);
  if (!context) {
    throw new Error("useDemoWorkspace must be used inside DemoWorkspaceProvider.");
  }

  return context;
}
