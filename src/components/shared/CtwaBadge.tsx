import { Megaphone, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getCtwaInfo, networkLabel } from "@/lib/ctwa";

interface Props {
  contact: Parameters<typeof getCtwaInfo>[0];
  className?: string;
}

export function CtwaBadge({ contact, className }: Props) {
  const info = getCtwaInfo(contact);
  if (!info) return null;
  const label = `Anúncio · ${networkLabel(info.network)}`;

  const badge = (
    <Badge variant="secondary" className={"gap-1 font-normal " + (className ?? "")}>
      <Megaphone className="h-3 w-3" />
      {label}
    </Badge>
  );

  const hasDetails = info.headline || info.body || info.sourceUrl;
  if (!hasDetails) return badge;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs space-y-1 text-xs">
          <div className="text-muted-foreground">Origem: Anúncio</div>
          {info.headline && <div className="font-medium">{info.headline}</div>}
          {info.body && <div className="text-muted-foreground line-clamp-3">{info.body}</div>}
          {info.sourceUrl && (
            <a
              href={info.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Abrir anúncio <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
