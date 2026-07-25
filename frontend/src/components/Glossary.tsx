import { usePreferences } from '../preferences'

export default function Glossary({ onSelect, activeIds }: { onSelect: (ids: string[]) => void; activeIds: string[] }) {
  const { tr } = usePreferences()
  const glossary = [
    { term: tr('Граф знаний', 'Knowledge graph'), def: tr('Знание хранится один раз; формы ссылаются на объекты.', 'Knowledge is stored once; forms reference objects.'), nodeIds: ['core'] },
    { term: 'Control Knowledge', def: tr('КС, DELTA, контрольные отчёты.', 'Validation rules, DELTA and control reports.'), nodeIds: ['ctrl'] },
    { term: 'ODS Knowledge', def: tr('Модель данных и lineage.', 'Data model and lineage.'), nodeIds: ['ods', 'a-ods'] },
    { term: 'Reporting Knowledge', def: tr('Формы отчётности, пилот 0409101.', 'Reporting forms and the 0409101 pilot.'), nodeIds: ['rep', 'a-f101'] },
    { term: 'Regulatory Knowledge', def: tr('809-П, 6406-У, ФЛК.', '809-P, 6406-U and validation controls.'), nodeIds: ['reg'] },
    { term: 'Interest Scope', def: tr('Вычисляемая область интересов Actor.', 'A computed area of interest for an Actor.'), nodeIds: ['core', 'aian'] },
    { term: 'Actor', def: 'Human | AIAgent | Service | ExternalSystem.', nodeIds: ['econ', 'aian'] },
    { term: 'Synthetic Stand', def: tr('Проверка знаний на синтетике.', 'Knowledge validation on synthetic data.'), nodeIds: ['stand'] },
    { term: tr('Инженер ИИ', 'AI Engineer'), def: tr('Модель знаний, eval, перенос.', 'Knowledge model, eval and migration.'), nodeIds: ['aian', 'p-aian'] },
    { term: tr('Экономист', 'Economist'), def: tr('Сдаёт форму, отвечает за результат.', 'Submits the form and owns the result.'), nodeIds: ['econ', 'a-econ'] }
  ]
  return (
    <div className="panel">
      <h3>{tr('Глоссарий', 'Glossary')}</h3>
      <p className="sub-hint">{tr('Нажмите термин, чтобы подсветить связанные узлы', 'Select a term to highlight related nodes')}</p>
      <div className="gloss-list">
        {glossary.map(g => {
          const on = g.nodeIds.some(id => activeIds?.includes(id))
          return (
            <button key={g.term} type="button" className={`gloss-item ${on ? 'on' : ''}`} onClick={() => onSelect(g.nodeIds)}>
              <strong>{g.term}</strong>
              <span>{g.def}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
