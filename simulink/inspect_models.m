% Print each part's entered values from the saved models and save a picture of each diagram.
% Run from simulink/out:  matlab -batch "run('../inspect_models.m')"
here = fileparts(mfilename('fullpath'));
for name = {'handwritten', 'circuit1', 'inverter', 'circuit'}
    folder = fullfile(here, 'out', name{1});
    model = [name{1} '_sim'];
    load_system(fullfile(folder, [model '.slx']));
    fprintf('== %s\n', model);
    for b = find_system(model, 'SearchDepth', 1, 'Type', 'Block')'
        params = {'R', 'c', 'l', 'v0', 'amp'};
        for p = params
            try
                fprintf('  %-8s %s = %s %s\n', get_param(b{1}, 'Name'), p{1}, get_param(b{1}, p{1}), ...
                        get_param(b{1}, [p{1} '_unit']));
            catch
            end
        end
    end
    print(['-s' model], '-dpng', fullfile(folder, [model '.png']));
    close_system(model, 0);
end
